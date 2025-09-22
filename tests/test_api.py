import importlib
import importlib.util
from pathlib import Path


def _load_api_app_module():
    path = Path(__file__).resolve().parents[1] / "api" / "app.py"
    spec = importlib.util.spec_from_file_location("api_app_module", path)
    if spec is None:
        raise ImportError(f"Could not load spec for {path}")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_office_upsert_persists_retry_thresholds(monkeypatch, tmp_path):
    db_path = tmp_path / "sla.sqlite"
    monkeypatch.setenv("SLA_DB", str(db_path))

    app_module = _load_api_app_module()

    payload = {
        "name": "HQ",
        "gateway_ip": "1.1.1.1",
        "mx_ip": "2.2.2.2",
        "tunnel_probe_ip": "3.3.3.3",
        "retries_down": 3,
        "retries_up": 2,
    }

    resp = app_module.upsert_office(app_module.OfficeIn(**payload))
    assert resp["ok"] is True

    conn = app_module.db()
    try:
        row = conn.execute(
            "SELECT retries_down, retries_up FROM offices WHERE name=?", ("HQ",)
        ).fetchone()
        assert row["retries_down"] == 3
        assert row["retries_up"] == 2
    finally:
        conn.close()

    updated = dict(payload)
    updated["retries_down"] = 5
    updated["retries_up"] = 4

    resp = app_module.upsert_office(app_module.OfficeIn(**updated))
    assert resp["ok"] is True

    conn = app_module.db()
    try:
        row = conn.execute(
            "SELECT retries_down, retries_up FROM offices WHERE name=?", ("HQ",)
        ).fetchone()
        assert row["retries_down"] == 5
        assert row["retries_up"] == 4
    finally:
        conn.close()
