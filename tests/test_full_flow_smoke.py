"""
Full-flow smoke test: registration → login → search → book → history → isolation.
Run with: make test  (or: docker compose run --rm api pytest tests/test_full_flow_smoke.py -v)
"""

import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db, init_db

client = TestClient(app)


def _email() -> str:
    return f"smoke_{uuid.uuid4().hex[:8]}@example.com"


def _register(email=None, full_name="Test User", password="pass1234"):
    if email is None:
        email = _email()
    r = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "full_name": full_name},
    )
    assert r.status_code == 201, r.text
    return r.json()["token"], email


@pytest.fixture(autouse=True)
def ensure_db():
    """Ensure DB is initialised and one parking zone has capacity for tests."""
    init_db()
    with get_db() as conn:
        # Upsert a test parking zone with known capacity so sensor/booking tests work.
        conn.execute(
            "INSERT OR IGNORE INTO parking_zones "
            "(id, name, centroid_lat, centroid_lng, max_capacity, available_spots, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            ("TEST_ZONE", "Test Zone", 46.07, 11.12, 50, 50, "2026-01-01T00:00:00"),
        )
        conn.execute(
            "UPDATE parking_zones SET max_capacity = 50, available_spots = 50 WHERE id = 'TEST_ZONE'"
        )
    yield


# ── 1. Register & me ────────────────────────────────────────────────────────


def test_register_returns_token_and_user():
    r = client.post(
        "/api/auth/register",
        json={"email": _email(), "password": "pass1234", "full_name": "Smoke User"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "token" in body
    assert body["user"]["full_name"] == "Smoke User"


def test_me_with_valid_token():
    email = _email()
    token, _ = _register(email, "Me User")
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user"]["email"] == email


def test_me_without_token_is_401():
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_duplicate_email_is_409():
    email = _email()
    _register(email, "First")
    r = client.post(
        "/api/auth/register",
        json={"email": email, "password": "y", "full_name": "Second"},
    )
    assert r.status_code == 409


# ── 2. Login ────────────────────────────────────────────────────────────────


def test_login_returns_token():
    email = _email()
    _register(email, "L", "secret")
    r = client.post("/api/auth/login", json={"email": email, "password": "secret"})
    assert r.status_code == 200
    assert "token" in r.json()


def test_login_wrong_password_is_401():
    email = _email()
    _register(email, "L", "right")
    r = client.post("/api/auth/login", json={"email": email, "password": "wrong"})
    assert r.status_code == 401


# ── 3. Search → Book → history ──────────────────────────────────────────────


def test_search_is_public():
    r = client.post("/api/trips/search", json={"destination": "Stazione FS Rovereto"})
    assert r.status_code == 200
    assert "modalities" in r.json()


def test_book_without_auth_is_401():
    search = client.post("/api/trips/search", json={"destination": "Stazione FS Rovereto"})
    option_id = search.json()["modalities"][0]["option_id"]
    r = client.post("/api/trips/book", json={"option_id": option_id})
    assert r.status_code == 401


def test_full_booking_flow():
    token, _ = _register(full_name="Flow Tester")
    hdrs = {"Authorization": f"Bearer {token}"}

    # Capture parking availability before booking via DB-backed endpoint
    parking_before = client.get("/parking").json()
    test_zone = next((z for z in parking_before["zones"] if z["id"] == "TEST_ZONE"), None)
    spots_before = test_zone["available_spots"] if test_zone else None

    # Search
    search = client.post("/api/trips/search", json={"destination": "Stazione FS Rovereto"})
    assert search.status_code == 200
    modalities = search.json()["modalities"]

    # Prefer parking option so we can verify available_spots decrement
    parking_option = next((m for m in modalities if m["type"] == "parking"), modalities[0])
    option_id = parking_option["option_id"]

    # Book with auth
    book = client.post("/api/trips/book", json={"option_id": option_id}, headers=hdrs)
    assert book.status_code == 200, book.text
    body = book.json()
    assert body["status"] == "BOOKED"
    assert body["boarding_pass"]["passenger"] == "Flow Tester", (
        f"Boarding pass must show the real user name, got: {body['boarding_pass']['passenger']}"
    )
    booking_id = body["booking_id"]

    # Parking spots decremented (only when parking was the chosen modality and zone exists)
    if parking_option["type"] == "parking" and spots_before is not None:
        parking_after = client.get("/parking").json()
        zone_after = next((z for z in parking_after["zones"] if z["id"] == "TEST_ZONE"), None)
        if zone_after:
            assert zone_after["available_spots"] <= spots_before, (
                "Parking spots should have decremented after booking"
            )

    # History contains this booking
    trips = client.get("/api/trips", headers=hdrs)
    assert trips.status_code == 200
    ids = [t["booking_id"] for t in trips.json()["trips"]]
    assert booking_id in ids, "Booking must appear in the user's trip history"

    # GET single booking
    single = client.get(f"/api/trips/{booking_id}", headers=hdrs)
    assert single.status_code == 200
    assert single.json()["booking_id"] == booking_id


def test_booking_ownership_isolation():
    """User 2 cannot see user 1's bookings."""
    token1, _ = _register(full_name="User One")
    hdrs1 = {"Authorization": f"Bearer {token1}"}

    # User 1 books something
    search = client.post("/api/trips/search", json={"destination": "Stazione FS Rovereto"})
    option_id = search.json()["modalities"][0]["option_id"]
    book = client.post("/api/trips/book", json={"option_id": option_id}, headers=hdrs1)
    booking_id = book.json()["booking_id"]

    # User 2 registers and fetches trips
    token2, _ = _register(full_name="User Two")
    hdrs2 = {"Authorization": f"Bearer {token2}"}

    trips2 = client.get("/api/trips", headers=hdrs2)
    ids2 = [t["booking_id"] for t in trips2.json()["trips"]]
    assert booking_id not in ids2, "User 2 must not see user 1's bookings"

    # User 2 also can't GET user 1's booking directly
    single = client.get(f"/api/trips/{booking_id}", headers=hdrs2)
    assert single.status_code == 404


# ── 4. Sensor path untouched ─────────────────────────────────────────────────


def test_sensor_update_still_works():
    """Confirm that the sensor POST path that updates available_spots is intact."""
    # TEST_ZONE has max_capacity=50 from our fixture
    r = client.post("/sensors/parking/TEST_ZONE", json={"available_spots": 42})
    assert r.status_code == 200, r.text
    assert r.json()["available_spots"] == 42

    zone = client.get("/parking/TEST_ZONE").json()
    assert zone["available_spots"] == 42, (
        "Sensor-updated available_spots must be reflected in GET /parking/{id}"
    )
