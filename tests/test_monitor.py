import asyncio
import importlib.util
from pathlib import Path

import aiohttp
import pytest


def _load_monitor_module():
    path = Path(__file__).resolve().parents[1] / "monitor" / "monitor.py"
    spec = importlib.util.spec_from_file_location("monitor_module", path)
    assert spec is not None, "Failed to load module spec"
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


monitor = _load_monitor_module()


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_reconcile_updates_retry_thresholds(monkeypatch):
    calls = []

    class DummyIngestor:
        async def post_json(self, path, payload, **kwargs):
            calls.append((path, payload))

    async def fake_probe(*args, **kwargs):
        return None

    monkeypatch.setattr(monitor, "probe_office", fake_probe)

    async def run_test():
        mgr = monitor.OfficeManager(
            asyncio.Semaphore(5),
            DummyIngestor(),
            interval=1,
            timeout_ms=100,
        )

        initial = {
            "offices": [
                {
                    "name": "HQ",
                    "gateway_ip": "1.1.1.1",
                    "mx_ip": "2.2.2.2",
                    "tunnel_probe_ip": "3.3.3.3",
                    "retries_down": 3,
                    "retries_up": 2,
                }
            ]
        }
        await mgr.reconcile(initial)

        assert mgr.offices["HQ"].retries_down == 3
        assert mgr.offices["HQ"].retries_up == 2
        assert calls[-1][1]["retries_down"] == 3
        assert calls[-1][1]["retries_up"] == 2

        updated = {
            "offices": [
                {
                    "name": "HQ",
                    "gateway_ip": "1.1.1.1",
                    "mx_ip": "2.2.2.2",
                    "tunnel_probe_ip": "3.3.3.3",
                    "retries_down": 5,
                    "retries_up": 4,
                }
            ]
        }
        await mgr.reconcile(updated)

        assert mgr.offices["HQ"].retries_down == 5
        assert mgr.offices["HQ"].retries_up == 4
        assert calls[-1][1]["retries_down"] == 5
        assert calls[-1][1]["retries_up"] == 4

    asyncio.run(run_test())


@pytest.mark.anyio
async def test_ingestor_post_json_logs_and_raises_with_session(monkeypatch, caplog):
    ingestor = monitor.Ingestor("http://example", max_retries=2, retry_backoff=0)
    await ingestor.__aenter__()

    error = RuntimeError("boom")

    class FailingRequest:
        async def __aenter__(self):
            raise error

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def failing_post(*args, **kwargs):
        return FailingRequest()

    monkeypatch.setattr(ingestor._session, "post", failing_post)

    caplog.set_level("ERROR")

    try:
        with pytest.raises(RuntimeError):
            await ingestor.post_json(
                "/ingest/state_change",
                {"office": "HQ", "state": "down"},
                office_name="HQ",
            )
    finally:
        await ingestor.__aexit__(None, None, None)

    log_text = " ".join(r.getMessage() for r in caplog.records)
    assert "HQ" in log_text
    assert "/ingest/state_change" in log_text
    assert "attempt=2" in log_text


@pytest.mark.anyio
async def test_ingestor_post_json_logs_and_raises_without_session(monkeypatch, caplog):
    ingestor = monitor.Ingestor("http://example", max_retries=2, retry_backoff=0)

    error = aiohttp.ClientError("kaboom")

    class FailingRequest:
        async def __aenter__(self):
            raise error

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class DummyClientSession:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def post(self, *args, **kwargs):
            return FailingRequest()

    monkeypatch.setattr(monitor.aiohttp, "ClientSession", DummyClientSession)

    caplog.set_level("ERROR")

    with pytest.raises(aiohttp.ClientError):
        await ingestor.post_json(
            "/offices",
            {"name": "Remote", "gateway_ip": "1.2.3.4"},
            office_name="Remote",
        )

    log_text = " ".join(r.getMessage() for r in caplog.records)
    assert "Remote" in log_text
    assert "/offices" in log_text
    assert "attempt=2" in log_text
