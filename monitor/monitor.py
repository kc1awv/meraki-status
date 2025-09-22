import aiohttp, asyncio, contextlib, shutil, time, json, os, random, argparse, hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
import yaml

FPING = shutil.which("fping")
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=5)
API_BASE = os.environ.get("SLA_API", "http://localhost:8080")


@dataclass
class Office:
    name: str
    gateway_ip: str
    mx_ip: str
    tunnel_probe_ip: str
    retries_down: int = 2
    retries_up: int = 1
    state: str = "unknown"
    _fail_streak: int = 0
    _ok_streak: int = 0
    last_change: float = field(default_factory=time.time)
    last_sample: Dict[str, Any] = field(default_factory=dict)


def instant_state(gw: bool, mx: bool, ipsec: bool) -> str:
    if gw or mx:
        return "up" if ipsec else "degraded"
    return "down"


async def ping_host(host: str, timeout_ms: int = 900) -> bool:
    if FPING:
        proc = await asyncio.create_subprocess_exec(
            FPING,
            "-c1",
            f"-t{timeout_ms}",
            "-q",
            host,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        rc = await proc.wait()
        return rc == 0
    else:
        from ping3 import ping

        try:
            rtt = await asyncio.to_thread(
                ping, host, timeout=int(timeout_ms / 1000.0), unit="ms"
            )
            return rtt is not None
        except Exception:
            return False


async def limited_ping(
    host: str, limiter: asyncio.Semaphore, timeout_ms: int = 900
) -> bool:
    async with limiter:
        return await ping_host(host, timeout_ms=timeout_ms)


# NEW: keep one session per process for efficiency
class Ingestor:
    def __init__(self, base: str):
        self.base = base
        self._session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        # set default timeout for all requests
        self._session = aiohttp.ClientSession(
            raise_for_status=True,
            timeout=REQUEST_TIMEOUT,
        )
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self._session:
            await self._session.close()

    async def post_json(self, path: str, payload: dict | list):
        if not self._session:
            # fallback one-off if context not used
            async with aiohttp.ClientSession(
                raise_for_status=True,
                timeout=REQUEST_TIMEOUT,
            ) as sess:
                with contextlib.suppress(Exception):
                    async with sess.post(f"{self.base}{path}", json=payload) as resp:
                        await resp.text()
            return

        with contextlib.suppress(Exception):
            async with self._session.post(f"{self.base}{path}", json=payload) as resp:
                await resp.text()


def load_yaml_config(path: str) -> dict:
    with open(path, "r") as f:
        return yaml.safe_load(f)


def _office_default(field: str):
    return Office.__dataclass_fields__[field].default

def hash_office_record(o: dict) -> str:
    # stable hash of relevant identity/fields (change if you add more columns)
    h = hashlib.sha256()
    for k in (
        "name",
        "gateway_ip",
        "mx_ip",
        "tunnel_probe_ip",
        "retries_down",
        "retries_up",
    ):
        default = _office_default(k) if k.startswith("retries_") else ""
        h.update(str(o.get(k, default)).encode())
        h.update(b"|")
    return h.hexdigest()


class OfficeManager:
    def __init__(
        self, limiter: asyncio.Semaphore, ingestor, interval: int, timeout_ms: int
    ):
        self.limiter = limiter
        self.ingestor = ingestor
        self.interval = interval
        self.timeout_ms = timeout_ms
        self.offices: Dict[str, Office] = {}
        self.tasks: Dict[str, asyncio.Task] = {}
        self._hashes: Dict[str, str] = {}

    def list_offices(self) -> List[Office]:
        return list(self.offices.values())

    async def reconcile(self, offices_cfg: dict):
        desired = {o["name"]: o for o in offices_cfg.get("offices", [])}
        desired_hashes = {name: hash_office_record(o) for name, o in desired.items()}

        # removals
        for name in list(self.offices.keys()):
            if name not in desired:
                # stop task
                if t := self.tasks.pop(name, None):
                    t.cancel()
                self.offices.pop(name, None)
                self._hashes.pop(name, None)

        # additions/updates
        for name, rec in desired.items():
            h = desired_hashes[name]
            if name not in self.offices:
                # new office
                o = Office(**rec)
                self.offices[name] = o
                self._hashes[name] = h
                self.tasks[name] = asyncio.create_task(
                    probe_office(
                        o, self.limiter, self.ingestor, self.interval, self.timeout_ms
                    )
                )
                await self.ingestor.post_json(
                    "/offices",
                    {
                        "name": o.name,
                        "gateway_ip": o.gateway_ip,
                        "mx_ip": o.mx_ip,
                        "tunnel_probe_ip": o.tunnel_probe_ip,
                        "retries_down": o.retries_down,
                        "retries_up": o.retries_up,
                    },
                )
            elif self._hashes.get(name) != h:
                # updated IPs (or future fields)
                o = self.offices[name]
                o.gateway_ip = rec["gateway_ip"]
                o.mx_ip = rec["mx_ip"]
                o.tunnel_probe_ip = rec["tunnel_probe_ip"]
                o.retries_down = rec.get("retries_down", _office_default("retries_down"))
                o.retries_up = rec.get("retries_up", _office_default("retries_up"))
                self._hashes[name] = h
                await self.ingestor.post_json(
                    "/offices",
                    {
                        "name": o.name,
                        "gateway_ip": o.gateway_ip,
                        "mx_ip": o.mx_ip,
                        "tunnel_probe_ip": o.tunnel_probe_ip,
                        "retries_down": o.retries_down,
                        "retries_up": o.retries_up,
                    },
                )


async def probe_office(
    office: Office,
    limiter: asyncio.Semaphore,
    ingestor: Ingestor,
    interval=5,
    timeout_ms=900,
):
    await asyncio.sleep(random.uniform(0, min(0.5, interval / 4)))  # jitter
    while True:
        loop_start = time.monotonic()

        gw_task = asyncio.create_task(
            limited_ping(office.gateway_ip, limiter, timeout_ms)
        )
        mx_task = asyncio.create_task(limited_ping(office.mx_ip, limiter, timeout_ms))
        ipsec_task = asyncio.create_task(
            limited_ping(office.tunnel_probe_ip, limiter, timeout_ms)
        )
        gw, mx, ipsec = await asyncio.gather(gw_task, mx_task, ipsec_task)

        new_state = instant_state(gw, mx, ipsec)

        # debounce (unchanged)
        changed = False
        if new_state == office.state:
            office._ok_streak += 1
            office._fail_streak = 0
        elif new_state in {"down", "degraded"} and office.state in {"up", "unknown"}:
            office._fail_streak += 1
            if office._fail_streak >= office.retries_down:
                office.state = new_state
                office._fail_streak = 0
                office._ok_streak = 0
                office.last_change = time.time()
                changed = True
        else:
            office._ok_streak += 1
            if office._ok_streak >= office.retries_up:
                office.state = new_state
                office._ok_streak = 0
                office._fail_streak = 0
                office.last_change = time.time()
                changed = True

        office.last_sample = {
            "gateway": gw,
            "mx": mx,
            "ipsec": ipsec,
            "ts": int(time.time()),
        }

        if changed:
            # print for logs
            print(
                json.dumps(
                    {
                        "event": "state_change",
                        "office": office.name,
                        "state": office.state,
                        "sample": office.last_sample,
                        "at": int(office.last_change),
                    }
                )
            )
            # NEW: ingest state_change
            await ingestor.post_json(
                "/ingest/state_change",
                {
                    "office": office.name,
                    "state": office.state,
                    "sample": office.last_sample,
                    "at": int(office.last_change),
                },
            )

        # steady cadence
        elapsed = time.monotonic() - loop_start
        next_sleep = max(0.0, interval - elapsed)
        next_sleep += random.uniform(0, min(0.25, interval * 0.05))
        await asyncio.sleep(next_sleep)


async def oneshot(
    offices: List[Office], limiter: asyncio.Semaphore, timeout_ms: int = 900
):
    async def probe_single(o: Office):
        gw_task = asyncio.create_task(limited_ping(o.gateway_ip, limiter, timeout_ms))
        mx_task = asyncio.create_task(limited_ping(o.mx_ip, limiter, timeout_ms))
        ipsec_task = asyncio.create_task(
            limited_ping(o.tunnel_probe_ip, limiter, timeout_ms)
        )
        gw, mx, ipsec = await asyncio.gather(gw_task, mx_task, ipsec_task)
        state = instant_state(gw, mx, ipsec)
        sample = {"gateway": gw, "mx": mx, "ipsec": ipsec, "ts": int(time.time())}
        return {"office": o.name, "state": state, **sample}

    results = await asyncio.gather(*(probe_single(o) for o in offices))
    print(json.dumps({"event": "oneshot", "status": results}, separators=(",", ":")))


async def watch_offices_yaml(path: str, mgr: OfficeManager, poll_sec: int = 5):
    p = Path(path)
    last_mtime: Optional[float] = None
    while True:
        with contextlib.suppress(FileNotFoundError):
            mtime = p.stat().st_mtime
            if last_mtime is None or mtime > last_mtime:
                cfg = load_yaml_config(path)
                await mgr.reconcile(cfg)
                last_mtime = mtime
        await asyncio.sleep(poll_sec)


async def run(
    interval_seconds: Optional[int],
    timeout_ms: Optional[int],
    ping_concurrency: Optional[int],
    config_path: str,
    iterations: Optional[int],
    once: bool,
):
    # load base config once
    base_cfg = load_yaml_config(config_path)

    # resolve settings with CLI overrides
    interval = (
        interval_seconds
        if interval_seconds is not None
        else base_cfg.get("interval_seconds", 5)
    )
    timeout_ms = (
        timeout_ms if timeout_ms is not None else int(base_cfg.get("timeout_ms", 900))
    )
    ping_concurrency = (
        ping_concurrency
        if ping_concurrency is not None
        else int(os.environ.get("PING_CONCURRENCY", "20"))
    )

    limiter = asyncio.Semaphore(ping_concurrency)

    if once:
        offices = [Office(**o) for o in base_cfg.get("offices", [])]
        await oneshot(offices, limiter=limiter, timeout_ms=timeout_ms)
        return

    async with Ingestor(API_BASE) as ingestor:
        # Use the OfficeManager so YAML changes are respected
        mgr = OfficeManager(
            limiter=limiter, ingestor=ingestor, interval=interval, timeout_ms=timeout_ms
        )

        # Initial seed + start probe tasks (also upserts offices to the API)
        await mgr.reconcile(base_cfg)

        stop_event = asyncio.Event()

        async def ticker():
            interval_s = base_cfg.get("broadcast_seconds", 15)
            try:
                while not stop_event.is_set():
                    summary = [
                        {"office": o.name, "state": o.state, **o.last_sample}
                        for o in mgr.list_offices()
                    ]
                    print(json.dumps({"event": "tick", "status": summary}))
                    await ingestor.post_json("/ingest/tick", summary)
                    # wait until either stop is set or the interval expires
                    with contextlib.suppress(asyncio.TimeoutError):
                        await asyncio.wait_for(stop_event.wait(), timeout=interval_s)
            except asyncio.CancelledError:
                return  # graceful shutdown

        # Kick off background tasks
        bg_tasks = [
            asyncio.create_task(ticker()),
            asyncio.create_task(watch_offices_yaml(config_path, mgr, poll_sec=5)),
        ]

        # Optional bounded mode: stop after N ticks
        if iterations and iterations > 0:

            async def stop_after_n():
                for _ in range(iterations):
                    await asyncio.sleep(base_cfg.get("broadcast_seconds", 15))
                stop_event.set()
                await asyncio.sleep(0.1)
                # cancel probe tasks and background tasks
                for t in list(mgr.tasks.values()):
                    t.cancel()
                for t in bg_tasks:
                    t.cancel()

            bg_tasks.append(asyncio.create_task(stop_after_n()))

        try:
            # Wait on both probe tasks created by the manager and our background tasks
            await asyncio.gather(*bg_tasks, *mgr.tasks.values())
        except asyncio.CancelledError:
            for t in list(mgr.tasks.values()):
                t.cancel()
            for t in bg_tasks:
                t.cancel()
            with contextlib.suppress(Exception):
                await asyncio.gather(*mgr.tasks.values(), *bg_tasks)


def parse_args():
    p = argparse.ArgumentParser(description="Meraki office ping monitor")
    p.add_argument(
        "--config",
        default=os.environ.get("OFFICES_YAML", "offices.yaml"),
        help="Path to offices.yaml (default: %(default)s)",
    )
    p.add_argument(
        "--once",
        action="store_true",
        help="Run one concurrent probe pass and exit (no debouncing).",
    )
    p.add_argument(
        "--iterations",
        type=int,
        help="Run for N status ticks, then exit (helps in testing).",
    )
    p.add_argument(
        "--interval-seconds", type=int, help="Probe loop interval override (seconds)."
    )
    p.add_argument("--timeout-ms", type=int, help="Per-ping timeout override (ms).")
    p.add_argument(
        "--ping-concurrency",
        type=int,
        help="Global max concurrent pings (defaults to 20 or env PING_CONCURRENCY).",
    )
    return p.parse_args()


def main():
    args = parse_args()
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(
            run(
                interval_seconds=args.interval_seconds,
                timeout_ms=args.timeout_ms,
                ping_concurrency=args.ping_concurrency,
                config_path=args.config,
                iterations=args.iterations,
                once=args.once,
            )
        )


if __name__ == "__main__":
    main()
