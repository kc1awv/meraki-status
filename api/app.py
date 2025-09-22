from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import sqlite3, os, time
from typing import List, Optional, Literal

DB_PATH = os.environ.get("SLA_DB", "sla.sqlite")

app = FastAPI(title="Meraki SLA API")


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init():
    conn = db()
    cur = conn.cursor()
    cur.executescript(
        """
    CREATE TABLE IF NOT EXISTS offices (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      gateway_ip TEXT NOT NULL,
      mx_ip TEXT NOT NULL,
      tunnel_probe_ip TEXT NOT NULL,
      retries_down INTEGER NOT NULL DEFAULT 2,
      retries_up INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS state_changes (
      id INTEGER PRIMARY KEY,
      office_id INTEGER NOT NULL REFERENCES offices(id),
      at_ts INTEGER NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      sample_gateway INTEGER NOT NULL,
      sample_mx INTEGER NOT NULL,
      sample_ipsec INTEGER NOT NULL,
      UNIQUE (office_id, at_ts)
    );
    CREATE INDEX IF NOT EXISTS idx_state_changes_office_ts
      ON state_changes (office_id, at_ts);
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY,
      office_id INTEGER NOT NULL REFERENCES offices(id),
      ts INTEGER NOT NULL,
      gateway INTEGER NOT NULL,
      mx INTEGER NOT NULL,
      ipsec INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_samples_office_ts
      ON samples (office_id, ts);
    """
    )
    conn.commit()
    
    # migrations: ensure retry threshold columns exist
    cols = {row["name"] for row in cur.execute("PRAGMA table_info(offices)")}
    if "retries_down" not in cols:
        cur.execute(
            "ALTER TABLE offices ADD COLUMN retries_down INTEGER NOT NULL DEFAULT 2"
        )
    if "retries_up" not in cols:
        cur.execute(
            "ALTER TABLE offices ADD COLUMN retries_up INTEGER NOT NULL DEFAULT 1"
        )
    conn.commit()
    conn.close()


init()


class OfficeIn(BaseModel):
    name: str
    gateway_ip: str
    mx_ip: str
    tunnel_probe_ip: str
    retries_down: int = 2
    retries_up: int = 1


class TickSample(BaseModel):
    office: str
    state: Literal["unknown", "up", "degraded", "down"] = "unknown"  # optional in tick
    gateway: bool
    mx: bool
    ipsec: bool
    ts: int


class EventStateChange(BaseModel):
    office: str
    state: Literal["up", "degraded", "down"]
    sample: dict
    at: int


class OneShotRow(BaseModel):
    office: str
    state: Literal["up", "degraded", "down"]
    gateway: bool
    mx: bool
    ipsec: bool
    ts: int


def ensure_office(conn, o: OfficeIn) -> int:
    c = conn.cursor()
    c.execute("SELECT id FROM offices WHERE name=?", (o.name,))
    if row := c.fetchone():
        return row["id"]
    c.execute(
        """
        INSERT INTO offices(name,gateway_ip,mx_ip,tunnel_probe_ip,retries_down,retries_up)
        VALUES (?,?,?,?,?,?)
        """,
        (
            o.name,
            o.gateway_ip,
            o.mx_ip,
            o.tunnel_probe_ip,
            o.retries_down,
            o.retries_up,
        ),
    )
    conn.commit()
    return c.lastrowid


@app.post("/offices")
def upsert_office(o: OfficeIn):
    conn = db()
    try:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO offices(name,gateway_ip,mx_ip,tunnel_probe_ip,retries_down,retries_up)
            VALUES (:name,:gateway_ip,:mx_ip,:tunnel_probe_ip,:retries_down,:retries_up)
            ON CONFLICT(name) DO UPDATE SET
                gateway_ip=excluded.gateway_ip,
                mx_ip=excluded.mx_ip,
                tunnel_probe_ip=excluded.tunnel_probe_ip,
                retries_down=excluded.retries_down,
                retries_up=excluded.retries_up
        """,
            o.model_dump(),
        )
        conn.commit()
        # return id for convenience
        row = c.execute("SELECT id FROM offices WHERE name=?", (o.name,)).fetchone()
        return {"ok": True, "office_id": row["id"]}
    finally:
        conn.close()


@app.post("/ingest/state_change")
def ingest_state_change(ev: EventStateChange):
    conn = db()
    try:
        # find office
        c = conn.cursor()
        c.execute("SELECT id FROM offices WHERE name=?", (ev.office,))
        row = c.fetchone()
        if not row:
            raise HTTPException(400, f"Unknown office '{ev.office}'")
        oid = row["id"]

        c.execute(
            """
            INSERT OR IGNORE INTO state_changes(office_id, at_ts, from_state, to_state,
                                                sample_gateway, sample_mx, sample_ipsec)
            SELECT ?, ?, COALESCE((
                SELECT to_state FROM state_changes
                WHERE office_id=? AND at_ts < ?
                ORDER BY at_ts DESC LIMIT 1
            ), 'unknown') AS from_state,
            ?, ?, ?, ?
        """,
            (
                oid,
                ev.at,
                oid,
                ev.at,
                ev.state,
                int(bool(ev.sample.get("gateway"))),
                int(bool(ev.sample.get("mx"))),
                int(bool(ev.sample.get("ipsec"))),
            ),
        )
        conn.commit()
        return {"ok": True, "inserted": c.rowcount}
    finally:
        conn.close()


@app.post("/ingest/tick")
def ingest_tick(samples: List[TickSample]):
    conn = db()
    try:
        c = conn.cursor()
        for s in samples:
            c.execute("SELECT id FROM offices WHERE name=?", (s.office,))
            row = c.fetchone()
            if not row:
                raise HTTPException(400, f"Unknown office '{s.office}'")
            oid = row["id"]
            c.execute(
                "INSERT INTO samples(office_id, ts, gateway, mx, ipsec) VALUES (?,?,?,?,?)",
                (oid, s.ts, int(s.gateway), int(s.mx), int(s.ipsec)),
            )
        conn.commit()
        return {"ok": True, "count": len(samples)}
    finally:
        conn.close()


@app.get("/sla")
def sla(
    office: Optional[str] = None,
    t_start: Optional[int] = None,
    t_end: Optional[int] = None,
):
    now = int(time.time())
    t_end = t_end or now
    t_start = t_start or (t_end - 86400)  # default last 24h
    conn = db()
    try:
        c = conn.cursor()
        param_office = ""
        args: dict = {"t_start": t_start, "t_end": t_end}
        if office:
            param_office = "AND o.name = :office"
            args["office"] = office

        # build state spans
        sql = f"""
        WITH sc AS (
          SELECT s.office_id, s.at_ts, s.to_state AS state,
                 LEAD(s.at_ts, 1, :t_end) OVER (PARTITION BY s.office_id ORDER BY s.at_ts) AS next_ts
          FROM state_changes s
          WHERE s.at_ts < :t_end
        ),
        scw AS (
          SELECT office_id,
                 CASE WHEN at_ts < :t_start THEN :t_start ELSE at_ts END AS seg_start,
                 CASE WHEN next_ts > :t_end  THEN :t_end  ELSE next_ts END AS seg_end,
                 state
          FROM sc
          WHERE next_ts > :t_start
        ),
        sla AS (
          SELECT o.name AS office,
                 SUM(CASE WHEN state='up' THEN seg_end-seg_start ELSE 0 END) AS sec_up,
                 SUM(CASE WHEN state='degraded' THEN seg_end-seg_start ELSE 0 END) AS sec_deg,
                 SUM(CASE WHEN state='down' THEN seg_end-seg_start ELSE 0 END) AS sec_down,
                 (:t_end - :t_start) AS sec_total
          FROM scw
          JOIN offices o ON o.id = scw.office_id
          WHERE 1=1 {param_office}
          GROUP BY o.name
        ),
        latest AS (
          SELECT o.name AS office,
                 s.to_state AS current_state,
                 s.at_ts AS current_at,
                 s.from_state AS previous_state
          FROM (
            SELECT office_id, to_state, at_ts, from_state,
                   ROW_NUMBER() OVER (PARTITION BY office_id ORDER BY at_ts DESC) AS rn
            FROM state_changes
            WHERE at_ts <= :t_end
          ) s
          JOIN offices o ON o.id = s.office_id
          WHERE rn = 1
        ),
        latest_samples AS (
          SELECT o.name AS office,
                 sample.gateway,
                 sample.mx,
                 sample.ipsec,
                 sample.ts
          FROM (
            SELECT office_id, gateway, mx, ipsec, ts,
                   ROW_NUMBER() OVER (PARTITION BY office_id ORDER BY ts DESC) AS rn
            FROM samples
            WHERE ts <= :t_end
          ) sample
          JOIN offices o ON o.id = sample.office_id
          WHERE rn = 1
        )
        SELECT sla.office,
               sla.sec_up,
               sla.sec_deg,
               sla.sec_down,
               sla.sec_total,
               latest.current_state,
               latest.current_at,
               latest.previous_state,
               latest_samples.gateway AS latest_gateway,
               latest_samples.mx AS latest_mx,
               latest_samples.ipsec AS latest_ipsec,
               latest_samples.ts AS latest_sample_ts
        FROM sla
        LEFT JOIN latest ON latest.office = sla.office
        LEFT JOIN latest_samples ON latest_samples.office = sla.office
        ORDER BY sla.office;
        """
        rows = [dict(r) for r in c.execute(sql, args).fetchall()]
        for r in rows:
            total = max(1, r["sec_total"])
            r["uptime_strict"] = round(r["sec_up"] / total, 6)
            r["uptime_lenient"] = round((r["sec_up"] + r["sec_deg"]) / total, 6)
        return {"window": {"t_start": t_start, "t_end": t_end}, "sla": rows}
    finally:
        conn.close()
