import asyncio
import importlib.util
from pathlib import Path

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


def test_reconcile_updates_retry_thresholds(monkeypatch):
    calls = []

    class DummyIngestor:
        async def post_json(self, path, payload):
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
