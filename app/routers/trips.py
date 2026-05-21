"""
Trips router — two-step transactional booking flow.

POST /api/trips/search  →  reserves an option_id with live logistics
POST /api/trips/book    →  atomically locks resources, issues boarding pass
"""

from __future__ import annotations

import asyncio
import hashlib
import time as _time
import uuid
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/trips", tags=["trips"])

# ---------------------------------------------------------------------------
# In-memory resource state (simulates a DB with row-level locking)
# ---------------------------------------------------------------------------

_lock = Lock()

# option_id → {"status": "PENDING"|"BOOKED"|"EXPIRED", ...}
_OPTIONS: dict[str, dict[str, Any]] = {}

_RESOURCES: dict[str, dict[str, Any]] = {
    "parking_stazione": {"free": 34, "total": 120},
    "bike_stazione":    {"available_bikes": 8, "available_docks": 12},
    "train_seats":      {"available": 42, "total": 180},
}

# ---------------------------------------------------------------------------
# Known destinations
# ---------------------------------------------------------------------------

_DESTINATIONS: dict[str, dict[str, Any]] = {
    "stazione fs rovereto": {
        "display": "Stazione FS Rovereto",
        "coords": [11.0407, 45.8906],
        "track": "Trento–Verona",
        "platform": 2,
        "departs_in_min": 14,
        "route_waypoints": [
            [11.121, 46.072],
            [11.095, 45.980],
            [11.063, 45.942],
            [11.041, 45.891],
        ],
    },
    "stazione fs trento": {
        "display": "Stazione FS Trento",
        "coords": [11.1185, 46.0716],
        "track": "Trento–Bolzano",
        "platform": 1,
        "departs_in_min": 7,
        "route_waypoints": [
            [11.121, 46.072],
            [11.119, 46.071],
        ],
    },
}

_DEFAULT_DEST_KEY = "stazione fs rovereto"

# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------


class SearchPayload(BaseModel):
    destination: str


class BookPayload(BaseModel):
    option_id: str


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _offset_iso(minutes: int) -> str:
    return _iso(_now_utc() + timedelta(minutes=minutes))


def _seat_from_id(option_id: str) -> str:
    digest = int(hashlib.sha256(option_id.encode()).hexdigest(), 16)
    row = (digest % 28) + 1
    col = ["A", "B", "C", "D"][(digest >> 8) % 4]
    return f"{row}{col}"


def _train_number(booking_id: str) -> str:
    return f"REG {2380 + (abs(hash(booking_id)) % 50)}"


def _resolve_dest(raw: str) -> dict[str, Any]:
    key = raw.strip().lower()
    return _DESTINATIONS.get(key) or _DESTINATIONS[_DEFAULT_DEST_KEY]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/search")
async def search_trips(payload: SearchPayload) -> dict[str, Any]:
    """
    Step 1 — find available logistics.  Returns an option_id that must be
    passed to /book within 10 minutes.  Simulated 600 ms processing delay.
    """
    await asyncio.sleep(0.6)

    dest = _resolve_dest(payload.destination)
    option_id = str(uuid.uuid4())
    now = _now_utc()
    expires_at = _iso(now + timedelta(minutes=10))

    with _lock:
        snapshot = {
            "parking_free":   _RESOURCES["parking_stazione"]["free"],
            "parking_total":  _RESOURCES["parking_stazione"]["total"],
            "bikes":          _RESOURCES["bike_stazione"]["available_bikes"],
            "docks":          _RESOURCES["bike_stazione"]["available_docks"],
            "train_avail":    _RESOURCES["train_seats"]["available"],
            "train_total":    _RESOURCES["train_seats"]["total"],
        }
        _OPTIONS[option_id] = {
            "status":     "PENDING",
            "dest_key":   payload.destination.strip().lower(),
            "created_at": _iso(now),
            "expires_at": expires_at,
        }

    return {
        "option_id":         option_id,
        "destination":       dest["display"],
        "destination_coords": dest["coords"],
        "expires_at":        expires_at,
        "train": {
            "departure_time":  _offset_iso(dest["departs_in_min"]),
            "track":           dest["track"],
            "platform":        dest["platform"],
            "available_seats": snapshot["train_avail"],
            "total_seats":     snapshot["train_total"],
        },
        "parking": {
            "zone":            "Parcheggio Stazione",
            "description":     "Parcheggio coperto — zona A",
            "free_spots":      snapshot["parking_free"],
            "total_spots":     snapshot["parking_total"],
            "distance_meters": 120,
        },
        "bike_sharing": {
            "station_name":    "Bike Sharing – Stazione",
            "available_bikes": snapshot["bikes"],
            "available_docks": snapshot["docks"],
            "distance_meters": 80,
        },
        "price_eur":       3.50,
        "route_waypoints": dest["route_waypoints"],
    }


@router.post("/book")
async def book_trip(payload: BookPayload) -> dict[str, Any]:
    """
    Step 2 — atomic lock.  Changes resource state to BOOKED and returns a
    confirmed booking payload with a digital boarding pass.
    Simulated 400 ms transaction delay.
    """
    await asyncio.sleep(0.4)

    with _lock:
        option = _OPTIONS.get(payload.option_id)

        if option is None:
            raise HTTPException(status_code=404, detail="option_id not found or expired")
        if option["status"] == "BOOKED":
            raise HTTPException(status_code=409, detail="Resource already booked — conflict")
        if option["status"] == "EXPIRED":
            raise HTTPException(status_code=410, detail="Option window expired")

        # ── Atomic state transition ──────────────────────────────────────────
        option["status"] = "BOOKED"
        _RESOURCES["parking_stazione"]["free"] = max(
            0, _RESOURCES["parking_stazione"]["free"] - 1
        )
        _RESOURCES["bike_stazione"]["available_bikes"] = max(
            0, _RESOURCES["bike_stazione"]["available_bikes"] - 1
        )
        _RESOURCES["train_seats"]["available"] = max(
            0, _RESOURCES["train_seats"]["available"] - 1
        )

    dest = _resolve_dest(option["dest_key"])
    booking_id = f"CS-{str(uuid.uuid4())[:8].upper()}"
    now_iso = _iso(_now_utc())

    return {
        "booking_id":   booking_id,
        "option_id":    payload.option_id,
        "status":       "BOOKED",
        "confirmed_at": now_iso,
        "boarding_pass": {
            "booking_id":        booking_id,
            "passenger":         "Passeggero CommuteSync",
            "qr_payload":        f"CS:{booking_id}:{payload.option_id[:8]}",
            "train_code":        _train_number(booking_id),
            "origin":            "Trento",
            "destination":       dest["display"],
            "departure_time":    _offset_iso(dest["departs_in_min"]),
            "platform":          dest["platform"],
            "seat":              _seat_from_id(payload.option_id),
            "validity":          "Solo andata",
            "route_waypoints":   dest["route_waypoints"],
            "destination_coords": dest["coords"],
        },
    }
