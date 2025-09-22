import importlib
import sys

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def api_client(monkeypatch, tmp_path):
    db_path = tmp_path / "sla.sqlite"
    monkeypatch.setenv("SLA_DB", str(db_path))

    # Ensure the FastAPI module is freshly imported with the isolated DB.
    if "api.app" in sys.modules:
        del sys.modules["api.app"]

    module = importlib.import_module("api.app")

    with TestClient(module.app) as client:
        yield client, module


def _post_office(client):
    payload = {
        "name": "HQ",
        "gateway_ip": "1.1.1.1",
        "mx_ip": "2.2.2.2",
        "tunnel_probe_ip": "3.3.3.3",
        "retries_down": 3,
        "retries_up": 2,
    }
    resp = client.post("/offices", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["office_id"] > 0
    return payload, body


def test_offices_create_and_update(api_client):
    client, module = api_client
    payload, create_body = _post_office(client)

    # Update the office with new retry thresholds.
    payload["retries_down"] = 5
    payload["retries_up"] = 4
    resp = client.post("/offices", json=payload)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Verify the updates were persisted.
    conn = module.db()
    try:
        row = conn.execute(
            "SELECT gateway_ip, mx_ip, tunnel_probe_ip, retries_down, retries_up FROM offices WHERE id=?",
            (create_body["office_id"],),
        ).fetchone()
        assert row["gateway_ip"] == payload["gateway_ip"]
        assert row["mx_ip"] == payload["mx_ip"]
        assert row["tunnel_probe_ip"] == payload["tunnel_probe_ip"]
        assert row["retries_down"] == 5
        assert row["retries_up"] == 4
    finally:
        conn.close()


def test_ingest_state_change_transitions_and_overlap(api_client):
    client, module = api_client
    _post_office(client)

    event = {
        "office": "HQ",
        "state": "down",
        "sample": {"gateway": False, "mx": False, "ipsec": False},
        "at": 100,
    }
    resp = client.post("/ingest/state_change", json=event)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "inserted": 1}

    follow_up = {
        "office": "HQ",
        "state": "up",
        "sample": {"gateway": True, "mx": True, "ipsec": True},
        "at": 200,
    }
    resp = client.post("/ingest/state_change", json=follow_up)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "inserted": 1}

    overlap = dict(follow_up)
    overlap["state"] = "degraded"
    resp = client.post("/ingest/state_change", json=overlap)
    assert resp.status_code == 200
    # Unique constraint prevents duplicate timestamp inserts.
    assert resp.json() == {"ok": True, "inserted": 0}

    conn = module.db()
    try:
        rows = conn.execute(
            "SELECT at_ts, from_state, to_state FROM state_changes ORDER BY at_ts"
        ).fetchall()
        assert [(row["at_ts"], row["from_state"], row["to_state"]) for row in rows] == [
            (100, "unknown", "down"),
            (200, "down", "up"),
        ]
    finally:
        conn.close()


def test_ingest_state_change_unknown_office(api_client):
    client, _ = api_client
    resp = client.post(
        "/ingest/state_change",
        json={
            "office": "UNKNOWN",
            "state": "down",
            "sample": {"gateway": False, "mx": False, "ipsec": False},
            "at": 123,
        },
    )
    assert resp.status_code == 400
    assert "Unknown office" in resp.json()["detail"]


def test_ingest_tick_inserts_samples(api_client):
    client, module = api_client
    _post_office(client)

    samples = [
        {
            "office": "HQ",
            "gateway": True,
            "mx": False,
            "ipsec": True,
            "ts": 10,
        },
        {
            "office": "HQ",
            "gateway": False,
            "mx": True,
            "ipsec": True,
            "ts": 20,
        },
    ]
    resp = client.post("/ingest/tick", json=samples)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "count": 2}

    conn = module.db()
    try:
        rows = conn.execute(
            "SELECT ts, gateway, mx, ipsec FROM samples ORDER BY ts"
        ).fetchall()
        assert len(rows) == 2
        assert rows[0]["ts"] == 10
        assert rows[0]["gateway"] == 1
        assert rows[0]["mx"] == 0
        assert rows[1]["mx"] == 1
    finally:
        conn.close()


def test_ingest_tick_unknown_office(api_client):
    client, _ = api_client
    resp = client.post(
        "/ingest/tick",
        json=[
            {
                "office": "UNKNOWN",
                "gateway": True,
                "mx": True,
                "ipsec": True,
                "ts": 42,
            }
        ],
    )
    assert resp.status_code == 400
    assert "Unknown office" in resp.json()["detail"]


def test_sla_window_and_metrics(api_client):
    client, _ = api_client
    _post_office(client)

    events = [
        {
            "office": "HQ",
            "state": "down",
            "sample": {"gateway": False, "mx": False, "ipsec": False},
            "at": 0,
        },
        {
            "office": "HQ",
            "state": "degraded",
            "sample": {"gateway": True, "mx": False, "ipsec": True},
            "at": 30,
        },
        {
            "office": "HQ",
            "state": "up",
            "sample": {"gateway": True, "mx": True, "ipsec": True},
            "at": 90,
        },
    ]
    for event in events:
        resp = client.post("/ingest/state_change", json=event)
        assert resp.status_code == 200

    resp = client.get("/sla", params={"office": "HQ", "t_start": 10, "t_end": 150})
    assert resp.status_code == 200
    body = resp.json()
    assert body["window"] == {"t_start": 10, "t_end": 150}
    assert len(body["sla"]) == 1

    sla_entry = body["sla"][0]
    assert sla_entry["office"] == "HQ"
    assert sla_entry["sec_down"] == 20
    assert sla_entry["sec_deg"] == 60
    assert sla_entry["sec_up"] == 60
    assert sla_entry["sec_total"] == 140
    assert sla_entry["current_state"] == "up"
    assert sla_entry["previous_state"] == "degraded"
    assert sla_entry["uptime_strict"] == pytest.approx(60 / 140)
    assert sla_entry["uptime_lenient"] == pytest.approx(120 / 140)

    # Unknown offices should not blow up and simply return an empty list.
    resp = client.get("/sla", params={"office": "UNKNOWN", "t_start": 0, "t_end": 150})
    assert resp.status_code == 200
    assert resp.json()["sla"] == []
