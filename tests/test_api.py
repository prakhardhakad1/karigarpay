from datetime import timedelta
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
import json
import sqlite3
import sys
import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from karigarpay.app import create_app
from karigarpay.config import Settings
from karigarpay.money import today_ist


@pytest.fixture
def app(tmp_path):
    return create_app(Settings(tmp_path / "karigarpay.db", tmp_path / "photos", env="test", origins=("http://testserver",), hosts=("testserver",)))


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client


def register(client, name="Sharma Garments", phone="9876543210"):
    response = client.post("/api/auth/register", json={"name": name, "owner_name": "Prakhar", "owner_phone": phone, "pin": "1248"})
    assert response.status_code == 201, response.text
    data = response.json()
    client.headers["X-CSRF-Token"] = data["csrf_token"]
    return data


def worker(client, model="piece", salary=0, phone="9876543211", policy=None, upi="ramesh@upi"):
    r = client.post("/api/workers", json={"name": "Ramesh Kumar", "phone": phone, "pin": "2468", "payment_model": model, "salary": salary, "overtime_policy": policy, "upi_id": upi})
    assert r.status_code == 201, r.text
    return r.json()


def task(client):
    return next(t for t in client.get("/api/tasks").json()["items"] if t["name"] == "Packing")


def work(client, w, quantity=10, day=None, ot=2, attendance=None, photo_id=None):
    payload = {"worker_id": w["id"], "work_date": str(day or today_ist()), "items": [{"task_id": task(client)["id"], "quantity": quantity}] if w["payment_model"] == "piece" else [], "ot_hours": ot, "attendance": attendance, "request_id": str(uuid4()), "photo_id": photo_id}
    r = client.post("/api/submissions", json=payload)
    assert r.status_code == 201, r.text
    return r.json(), payload


def approve(client, entry):
    r = client.post(f"/api/submissions/{entry['id']}/review", json={"action": "approve"})
    assert r.status_code == 200, r.text
    return r.json()


def preview(client, w, start=None, end=None):
    r = client.get("/api/payroll/preview", params={"worker_id": w["id"], "start": str(start or today_ist()), "end": str(end or today_ist())})
    assert r.status_code == 200, r.text
    return r.json()


def settlement_data(p, method="cash"):
    return {"worker_id": p["worker"]["id"], "start": p["start"], "end": p["end"], "fingerprint": p["fingerprint"], "method": method, "reference": "BANK1234" if method == "upi" else "", "confirmed": True, "request_id": str(uuid4())}


def advance(client, w, amount, day=None):
    r = client.post("/api/advances", json={"worker_id": w["id"], "date": str(day or today_ist()), "amount": amount, "note": "Groceries", "request_id": str(uuid4())})
    assert r.status_code == 201, r.text
    return r.json()


def test_health_init_and_public_assets(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/ready").status_code == 200
    assert client.get("/").status_code == 200
    assert client.get("/manifest.webmanifest").json()["display"] == "standalone"
    assert client.get("/sw.js").headers["service-worker-allowed"] == "/"
    assert client.get("/api/tasks").status_code == 401


def test_registration_private_cookie_and_no_pin_leak(client, app):
    a = register(client)
    assert a["business"]["id"].startswith("BIZ-")
    assert "pin_hash" not in a["user"]
    assert len(client.get("/api/tasks").json()["items"]) == 4
    result = client.get("/api/auth/me")
    assert result.json()["user"]["name"] == "Prakhar"
    assert result.headers["cache-control"] == "no-store, private"
    cookies = list(client.cookies.jar)
    assert cookies[0]._rest["HttpOnly"] is None
    assert cookies[0]._rest["SameSite"] == "strict"
    with app.state.db.transaction() as conn:
        assert conn.execute("SELECT pin_hash FROM users").fetchone()[0].startswith("scrypt$")
        assert conn.execute("SELECT token_hash FROM sessions").fetchone()[0] != cookies[0].value


def test_csrf_origin_and_roles(client, app):
    a = register(client)
    csrf = client.headers.pop("X-CSRF-Token")
    assert client.post("/api/tasks", json={"name": "Test", "unit": "unit", "rate": 1}).status_code == 403
    client.headers["X-CSRF-Token"] = csrf
    assert client.post("/api/tasks", headers={"Origin": "https://evil.test"}, json={"name": "Test", "unit": "unit", "rate": 1}).status_code == 403
    w = worker(client)
    with TestClient(app) as wc:
        r = wc.post("/api/auth/login", json={"business_id": a["business"]["id"], "phone": w["phone"], "pin": "2468", "role": "worker"})
        wc.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        assert wc.get("/api/workers").status_code == 403
        assert wc.get("/api/payroll").status_code == 403
        assert wc.get("/api/audit").status_code == 403
        assert wc.post("/api/submissions/approve-all", json={"date": str(today_ist())}).status_code == 403
        assert wc.patch("/api/business", json={"name": "Hacked"}).status_code == 403
        assert wc.get("/api/worker/dashboard").status_code == 200


def test_complete_piece_advance_payroll_and_replay(client):
    register(client)
    w = worker(client)
    entry, payload = work(client, w)
    assert entry["base"] == 150 and entry["overtime"] == 100 and entry["total"] == 250
    duplicate = client.post("/api/submissions", json=payload)
    assert duplicate.json()["id"] == entry["id"]
    altered = {**payload, "ot_hours": 3}
    assert client.post("/api/submissions", json=altered).status_code == 409
    approve(client, entry)
    adv = advance(client, w, 50)
    p = preview(client, w)
    assert p["net"] == 200
    assert "am=200.00" in p["upi_uri"]
    qr = client.get(p["qr_url"])
    assert qr.status_code == 200 and qr.content.startswith(b"\x89PNG")
    payload = settlement_data(p, "upi")
    result = client.post("/api/settlements", json=payload)
    assert result.status_code == 201, result.text
    assert result.json()["net"] == 200
    assert result.json()["verification"] == "owner_confirmed_only"
    assert "Payment not yet" not in result.json()["whatsapp_text"]
    repeat = client.post("/api/settlements", json=payload)
    assert repeat.status_code == 201 and repeat.json()["id"] == result.json()["id"]
    assert preview(client, w)["net"] == 0
    assert client.post(f"/api/advances/{adv['id']}/void", json={"reason": "Correction"}).status_code == 409
    assert client.get("/api/payroll").json()["totals"]["net"] == 0


def test_approvals_are_snapshot_based_and_locked(client):
    register(client)
    w = worker(client)
    entry, payload = work(client, w)
    tid = task(client)["id"]
    assert client.patch(f"/api/tasks/{tid}", json={"rate": 30}).status_code == 200
    assert approve(client, entry)["base"] == 150
    assert client.put(f"/api/submissions/{entry['id']}", json=payload).status_code == 409
    assert client.post(f"/api/submissions/{entry['id']}/review", json={"action": "reject"}).status_code == 409
    assert preview(client, w)["base"] == 150


def test_daily_half_attendance_and_monthly_rounding(client):
    register(client)
    daily = worker(client, "daily", 500)
    entry, _ = work(client, daily, attendance="half", ot=2)
    assert entry["base"] == 250 and entry["overtime"] == 100
    monthly = worker(client, "monthly", 15000, phone="9876543212", policy={"mode": "multiplier", "multiplier": 1.5})
    entry, _ = work(client, monthly, attendance="full", ot=2)
    assert entry["base"] == 576.92
    assert entry["overtime"] == 216.35
    assert entry["total"] == 793.27


@pytest.mark.parametrize("policy,hours,expected", [
    ({"mode": "hourly", "hourly_rate": 60}, 1.5, 90),
    ({"mode": "shift", "half_shift_rate": 220, "full_shift_rate": 410}, 12, 630),
    ({"mode": "flat", "flat_rate": 175}, 0.5, 175),
    ({"mode": "multiplier", "hourly_rate": 60, "multiplier": 1.5}, 2, 180),
    ({"mode": "none"}, 0, 0),
])
def test_all_overtime_modes(client, policy, hours, expected):
    register(client)
    w = worker(client, policy=policy)
    entry, _ = work(client, w, ot=hours)
    assert entry["overtime"] == expected


def test_invalid_shift_absent_and_future_rejected(client):
    register(client)
    w = worker(client, "daily", 500, policy={"mode": "shift"})
    body = {"worker_id": w["id"], "work_date": str(today_ist()), "items": [], "attendance": "full", "ot_hours": 2, "request_id": str(uuid4())}
    assert client.post("/api/submissions", json=body).status_code == 400
    body.update(attendance="absent", ot_hours=4)
    assert client.post("/api/submissions", json=body).status_code == 400
    body.update(attendance="full", ot_hours=4, work_date=str(today_ist() + timedelta(days=1)))
    assert client.post("/api/submissions", json=body).status_code == 400


def test_negative_balance_carries_prior_advance(client):
    register(client)
    w = worker(client)
    advance(client, w, 500, today_ist() - timedelta(days=40))
    entry, _ = work(client, w, ot=0)
    approve(client, entry)
    p = preview(client, w)
    assert p["net"] == -350
    assert p["carry_in"]["advances"] == 500
    assert not p["upi_uri"]
    assert client.post("/api/settlements", json=settlement_data(p)).status_code == 409
    entry2, _ = work(client, w, quantity=30, ot=0, day=today_ist() - timedelta(days=1))
    approve(client, entry2)
    p = preview(client, w)
    assert p["net"] == 100
    assert p["carry_in"]["base"] == 450
    assert client.post("/api/settlements", json=settlement_data(p)).status_code == 201
    assert preview(client, w)["net"] == 0


def test_stale_preview_pending_guard_and_zero_adjustment(client):
    register(client)
    w = worker(client)
    entry, _ = work(client, w, ot=0)
    pending_preview = preview(client, w)
    assert pending_preview["pending_count"] == 1
    assert client.post("/api/settlements", json=settlement_data(pending_preview)).status_code == 409
    approve(client, entry)
    stale = preview(client, w)
    advance(client, w, 150)
    assert client.post("/api/settlements", json=settlement_data(stale)).status_code == 409
    zero = preview(client, w)
    assert zero["net"] == 0
    assert client.post("/api/settlements", json=settlement_data(zero)).status_code == 400
    assert client.post("/api/settlements", json=settlement_data(zero, "adjustment")).status_code == 201


def test_tenant_and_worker_isolation(client, app):
    one = register(client)
    w1 = worker(client)
    entry, _ = work(client, w1)
    with TestClient(app) as c2:
        register(c2, "Second Workshop", "9876543220")
        w2 = worker(c2, phone="9876543221")
        assert c2.get(f"/api/submissions/{entry['id']}").status_code == 404
        assert c2.patch(f"/api/workers/{w1['id']}", json={"name": "Intruder"}).status_code == 404
        assert c2.get("/api/payroll/preview", params={"worker_id": w1["id"]}).status_code == 404
        response = c2.post("/api/submissions", json={"worker_id": w2["id"], "work_date": str(today_ist()), "items": [{"task_id": task(client)["id"], "quantity": 2}], "request_id": str(uuid4())})
        assert response.status_code == 422
    w3 = worker(client, phone="9876543213")
    with TestClient(app) as wc:
        login = wc.post("/api/auth/login", json={"business_id": one["business"]["id"], "phone": w3["phone"], "pin": "2468", "role": "worker"}).json()
        wc.headers["X-CSRF-Token"] = login["csrf_token"]
        assert wc.get(f"/api/submissions/{entry['id']}").status_code == 403
        assert wc.get("/api/submissions").json()["items"] == []
        assert wc.get("/api/advances", params={"worker_id": w1["id"]}).status_code == 403


def test_bulk_only_selected_day_and_business(client, app):
    register(client)
    w = worker(client)
    today, _ = work(client, w)
    yesterday, _ = work(client, w, day=today_ist() - timedelta(days=1))
    r = client.post("/api/submissions/approve-all", json={"date": str(today_ist())})
    assert r.json()["approved_count"] == 1
    assert client.get(f"/api/submissions/{yesterday['id']}").json()["status"] == "pending"
    assert client.post("/api/submissions/approve-all", json={"date": str(today_ist())}).json()["approved_count"] == 0


def test_reject_edit_and_worker_pin_revocation(client, app):
    business = register(client)
    w = worker(client)
    entry, body = work(client, w)
    assert client.post(f"/api/submissions/{entry['id']}/review", json={"action": "reject", "note": "Check bundles"}).status_code == 200
    with TestClient(app) as wc:
        login = wc.post("/api/auth/login", json={"business_id": business["business"]["id"], "phone": w["phone"], "pin": "2468", "role": "worker"}).json()
        wc.headers["X-CSRF-Token"] = login["csrf_token"]
        body["items"][0]["quantity"] = 12
        response = wc.put(f"/api/submissions/{entry['id']}", json=body)
        assert response.status_code == 200
        assert response.json()["status"] == "pending"
        assert response.json()["base"] == 180
        assert client.patch(f"/api/workers/{w['id']}", json={"pin": "4321"}).status_code == 200
        assert wc.get("/api/auth/me").status_code == 401


def test_photo_sanitization_authorization_and_invalid_upload(client, app):
    business = register(client)
    w = worker(client)
    out = BytesIO()
    Image.new("RGB", (30, 30), "red").save(out, format="PNG")
    uploaded = client.post("/api/photos", files={"file": ("proof.png", out.getvalue(), "image/png")})
    assert uploaded.status_code == 201, uploaded.text
    photo = uploaded.json()
    assert client.get(photo["url"]).headers["content-type"] == "image/jpeg"
    assert client.post("/api/photos", files={"file": ("bad.jpg", b"<script>alert(1)</script>", "image/jpeg")}).status_code == 422
    assert client.post("/api/photos", files={"file": ("bad.svg", b"<svg/>", "image/svg+xml")}).status_code == 415
    assert client.post("/api/photos", files={"file": ("huge.jpg", b"x" * (5 * 1024 * 1024 + 1), "image/jpeg")}).status_code == 413
    with TestClient(app) as wc:
        login = wc.post("/api/auth/login", json={"business_id": business["business"]["id"], "phone": w["phone"], "pin": "2468", "role": "worker"}).json()
        wc.headers["X-CSRF-Token"] = login["csrf_token"]
        assert wc.get(photo["url"]).status_code == 403
        entry, _ = work(client, w, photo_id=photo["id"])
        assert wc.get(photo["url"]).status_code == 200
    assert client.get("/static/../private_uploads/" + photo["id"] + ".jpg").status_code == 404


def test_login_lockout_persists_failed_transactions(client):
    business = register(client)
    client.post("/api/auth/logout")
    payload = {"business_id": business["business"]["id"], "phone": "9876543210", "pin": "9999", "role": "owner"}
    for _ in range(8):
        assert client.post("/api/auth/login", json=payload).status_code == 401
    payload["pin"] = "1248"
    assert client.post("/api/auth/login", json=payload).status_code == 429


def test_duplicate_day_concurrent_and_settlement_race(client, app):
    register(client)
    w = worker(client)
    data = {"worker_id": w["id"], "work_date": str(today_ist()), "items": [{"task_id": task(client)["id"], "quantity": 10}], "ot_hours": 0}
    cookies, headers = dict(client.cookies), dict(client.headers)
    def submit(_):
        with TestClient(app) as c:
            c.cookies.update(cookies)
            c.headers.update(headers)
            return c.post("/api/submissions", json={**data, "request_id": str(uuid4())})
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(submit, [0, 1]))
    assert sorted(r.status_code for r in result) == [201, 409]
    entry = next(r.json() for r in result if r.status_code == 201)
    approve(client, entry)
    p = preview(client, w)
    def settle(_):
        with TestClient(app) as c:
            c.cookies.update(cookies)
            c.headers.update(headers)
            return c.post("/api/settlements", json=settlement_data(p))
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(settle, [0, 1]))
    assert sorted(r.status_code for r in result) == [201, 409]
    assert len(client.get("/api/settlements").json()["items"]) == 1


def test_validation_rejects_unknown_fields_and_float_edge_cases(client):
    register(client)
    w = worker(client)
    assert client.post("/api/tasks", json={"name": "Invalid", "unit": "piece", "rate": -1}).status_code == 422
    assert client.post("/api/tasks", json={"name": "Invalid", "unit": "piece", "rate": "NaN"}).status_code == 422
    assert client.post("/api/tasks", json={"name": "Invalid", "unit": "piece", "rate": 1.001}).status_code == 422
    assert client.patch(f"/api/workers/{w['id']}", json={"business_id": "BIZ-HACK"}).status_code == 422
    assert client.patch("/api/business", json={"name": None}).status_code == 422
    assert client.post("/api/workers", json={"name": "Test", "phone": "1234567890", "pin": "1111"}).status_code == 422


def test_immutable_database_guards_and_audit(client, app):
    register(client)
    w = worker(client)
    entry, _ = work(client, w)
    approve(client, entry)
    with pytest.raises(sqlite3.IntegrityError):
        with app.state.db.transaction(write=True) as conn:
            conn.execute("UPDATE submissions SET base_paise=1 WHERE id=?", (entry["id"],))
    with pytest.raises(sqlite3.IntegrityError):
        with app.state.db.transaction(write=True) as conn:
            conn.execute("DELETE FROM audit")
    actions = [r["action"] for r in client.get("/api/audit").json()["items"]]
    assert "work.approved" in actions and "worker.created" in actions


def test_change_pin_logs_out_all_sessions(client):
    business = register(client)
    assert client.post("/api/auth/change-pin", json={"old_pin": "1248", "new_pin": "1235"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    response = client.post("/api/auth/login", json={"business_id": business["business"]["id"], "phone": "9876543210", "pin": "1235", "role": "owner"})
    assert response.status_code == 200


def test_archive_keeps_earned_wages_and_blocks_new_work(client):
    register(client)
    w = worker(client)
    entry, _ = work(client, w)
    approve(client, entry)
    client.patch(f"/api/workers/{w['id']}", json={"active": False})
    assert preview(client, w)["net"] == 250
    assert client.get("/api/dashboard").json()["worker_count"] == 0
    assert len(client.get("/api/payroll").json()["rows"]) == 1
    payload = {"worker_id": w["id"], "work_date": str(today_ist() - timedelta(days=1)), "items": [{"task_id": task(client)["id"], "quantity": 1}], "request_id": str(uuid4())}
    assert client.post("/api/submissions", json=payload).status_code == 400
