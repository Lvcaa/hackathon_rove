"""
Trips router — Discovery → Commit two-phase booking flow.

POST /api/trips/search  →  returns an array of bookable modalities, each with
                           its own unique option_id and per-resource snapshot.
POST /api/trips/book    →  atomically locks the specific chosen modality and
                           returns a generalised boarding pass.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/trips", tags=["trips"])

# ---------------------------------------------------------------------------
# In-memory resource state (row-level locking via threading.Lock)
# ---------------------------------------------------------------------------

_lock = Lock()

# option_id → {"status": "PENDING"|"BOOKED", "modality": str, "dest_key": str, ...}
_OPTIONS: dict[str, dict[str, Any]] = {}

_RESOURCES: dict[str, dict[str, Any]] = {
    "train_seats":      {"available": 42,  "total": 180},
    "parking_stazione": {"available": 34,  "total": 120},
    "bike_stazione":    {"available_bikes": 8, "available_docks": 12},
    # Taxi is dispatched on demand — no fixed pool to decrement
}

# ---------------------------------------------------------------------------
# Known destinations
# ---------------------------------------------------------------------------

_DESTINATIONS: dict[str, dict[str, Any]] = {
    "stazione fs rovereto": {
        "display":         "Stazione FS Rovereto",
        "coords":          [11.0407, 45.8906],
        "track":           "Trento–Verona",
        "platform":        2,
        "departs_in_min":  14,
        "route_waypoints": [
            [11.121, 46.072],
            [11.095, 45.980],
            [11.063, 45.942],
            [11.041, 45.891],
        ],
    },
    "stazione fs trento": {
        "display":         "Stazione FS Trento",
        "coords":          [11.1185, 46.0716],
        "track":           "Trento–Bolzano",
        "platform":        1,
        "departs_in_min":  7,
        "route_waypoints": [
            [11.121, 46.072],
            [11.119, 46.071],
        ],
    },
}

_DEFAULT_DEST_KEY = "stazione fs rovereto"

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class SearchPayload(BaseModel):
    destination: str


class BookPayload(BaseModel):
    option_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _offset_iso(minutes: int) -> str:
    return _iso(_now_utc() + timedelta(minutes=minutes))


def _resolve_dest(raw: str) -> dict[str, Any]:
    return _DESTINATIONS.get(raw.strip().lower()) or _DESTINATIONS[_DEFAULT_DEST_KEY]


def _seat(option_id: str) -> str:
    digest = int(hashlib.sha256(option_id.encode()).hexdigest(), 16)
    return f"{(digest % 28) + 1}{['A', 'B', 'C', 'D'][(digest >> 8) % 4]}"


def _parking_spot(booking_id: str) -> str:
    return f"A{abs(hash(booking_id)) % 60 + 1}"


def _reg_number(booking_id: str) -> str:
    return f"REG {2380 + abs(hash(booking_id)) % 50}"


def _new_option(dest_key: str, modality: str, expires_at: str) -> str:
    oid = str(uuid.uuid4())
    _OPTIONS[oid] = {
        "status":     "PENDING",
        "modality":   modality,
        "dest_key":   dest_key,
        "expires_at": expires_at,
    }
    return oid


# ---------------------------------------------------------------------------
# /search — Discovery phase
# ---------------------------------------------------------------------------


@router.post("/search")
async def search_trips(payload: SearchPayload) -> dict[str, Any]:
    """
    Returns an array of independent bookable modalities (train, parking, taxi,
    bike_sharing).  Each has its own option_id so the client can book exactly
    one without touching the others.  Simulated 600 ms discovery delay.
    """
    await asyncio.sleep(0.6)

    dest     = _resolve_dest(payload.destination)
    dest_key = payload.destination.strip().lower()
    now      = _now_utc()
    expires_at = _iso(now + timedelta(minutes=10))

    with _lock:
        # Snapshot live availability atomically
        train_avail   = _RESOURCES["train_seats"]["available"]
        train_total   = _RESOURCES["train_seats"]["total"]
        park_avail    = _RESOURCES["parking_stazione"]["available"]
        park_total    = _RESOURCES["parking_stazione"]["total"]
        bike_avail    = _RESOURCES["bike_stazione"]["available_bikes"]
        bike_docks    = _RESOURCES["bike_stazione"]["available_docks"]

        # Register one option_id per modality
        train_oid = _new_option(dest_key, "train",        expires_at)
        park_oid  = _new_option(dest_key, "parking",      expires_at)
        taxi_oid  = _new_option(dest_key, "taxi",         expires_at)
        bike_oid  = _new_option(dest_key, "bike_sharing", expires_at)

    modalities: list[dict[str, Any]] = [
        {
            "option_id":       train_oid,
            "type":            "train",
            "price_eur":       3.50,
            "expires_at":      expires_at,
            "departure_time":  _offset_iso(dest["departs_in_min"]),
            "track":           dest["track"],
            "platform":        dest["platform"],
            "available_seats": train_avail,
            "total_seats":     train_total,
        },
        {
            "option_id":        park_oid,
            "type":             "parking",
            "price_eur":        2.00,
            "expires_at":       expires_at,
            "zone":             "Parcheggio Stazione",
            "description":      "Parcheggio coperto — zona A",
            "available_spots":  park_avail,
            "total_spots":      park_total,
            "distance_meters":  120,
        },
        {
            "option_id":     taxi_oid,
            "type":          "taxi",
            "price_eur":     8.50,
            "expires_at":    expires_at,
            "eta_minutes":   4,
            "vehicle_model": "Tesla Model 3",
            "driver_name":   "Marco R.",
            "plate":         "TN 482 BX",
        },
        {
            "option_id":        bike_oid,
            "type":             "bike_sharing",
            "price_eur":        1.00,
            "expires_at":       expires_at,
            "station_name":     "Bike Sharing – Stazione",
            "available_bikes":  bike_avail,
            "available_docks":  bike_docks,
            "distance_meters":  80,
        },
    ]

    return {
        "destination":        dest["display"],
        "destination_coords": dest["coords"],
        "route_waypoints":    dest["route_waypoints"],
        "modalities":         modalities,
    }


# ---------------------------------------------------------------------------
# /book — Commit phase
# ---------------------------------------------------------------------------


@router.post("/book")
async def book_trip(payload: BookPayload) -> dict[str, Any]:
    """
    Atomically locks the single chosen modality resource and returns a
    boarding pass generalised across all modality types.
    Simulated 400 ms transaction delay.
    """
    await asyncio.sleep(0.4)

    with _lock:
        option = _OPTIONS.get(payload.option_id)

        if option is None:
            raise HTTPException(status_code=404, detail="option_id not found or expired")
        if option["status"] == "BOOKED":
            raise HTTPException(status_code=409, detail="Already booked — resource conflict")
        if option["status"] == "EXPIRED":
            raise HTTPException(status_code=410, detail="Option window expired")

        option["status"] = "BOOKED"
        modality = option["modality"]

        # Decrement only the relevant resource
        if modality == "train":
            _RESOURCES["train_seats"]["available"] = max(
                0, _RESOURCES["train_seats"]["available"] - 1
            )
        elif modality == "parking":
            _RESOURCES["parking_stazione"]["available"] = max(
                0, _RESOURCES["parking_stazione"]["available"] - 1
            )
        elif modality == "bike_sharing":
            _RESOURCES["bike_stazione"]["available_bikes"] = max(
                0, _RESOURCES["bike_stazione"]["available_bikes"] - 1
            )
        # taxi: dispatched on demand, no pool to decrement

    dest       = _resolve_dest(option["dest_key"])
    booking_id = f"CS-{str(uuid.uuid4())[:8].upper()}"
    now_iso    = _iso(_now_utc())

    # Build a modality-specific boarding pass using generic detail_lines
    if modality == "train":
        title    = _reg_number(booking_id)
        subtitle = f"Binario {dest['platform']} · Posto {_seat(payload.option_id)}"
        detail_lines = [
            {"label": "Partenza",  "value": _offset_iso(dest["departs_in_min"])},
            {"label": "Linea",     "value": dest["track"]},
            {"label": "Origine",   "value": "Trento"},
            {"label": "Validità",  "value": "Solo andata"},
        ]

    elif modality == "parking":
        spot = _parking_spot(booking_id)
        title    = "Parcheggio Stazione"
        subtitle = f"Zona A — Coperto · Posto {spot}"
        detail_lines = [
            {"label": "Posto assegnato",  "value": spot},
            {"label": "Codice ingresso",  "value": f"P{booking_id[-4:]}"},
            {"label": "Durata massima",   "value": "24 ore"},
            {"label": "Tariffa oraria",   "value": "€ 1,00 / ora"},
        ]

    elif modality == "taxi":
        title    = "Taxi CommuteSync"
        subtitle = "Tesla Model 3 · Marco R."
        detail_lines = [
            {"label": "Autista",    "value": "Marco R."},
            {"label": "Veicolo",    "value": "Tesla Model 3"},
            {"label": "Targa",      "value": "TN 482 BX"},
            {"label": "ETA",        "value": "~4 minuti"},
        ]

    else:  # bike_sharing
        bike_id = f"BIKE-{abs(hash(booking_id)) % 900 + 100}"
        title    = "Bike Sharing"
        subtitle = f"Stazione FS · Bici {bike_id}"
        detail_lines = [
            {"label": "ID bici",          "value": bike_id},
            {"label": "Codice sblocco",   "value": f"{abs(hash(booking_id)) % 9000 + 1000}"},
            {"label": "Stazione",         "value": "Bike Sharing – Stazione"},
            {"label": "Tariffa",          "value": "€ 1,00 / 30 min"},
        ]

    return {
        "booking_id":    booking_id,
        "option_id":     payload.option_id,
        "modality_type": modality,
        "status":        "BOOKED",
        "confirmed_at":  now_iso,
        "boarding_pass": {
            "booking_id":         booking_id,
            "passenger":          "Passeggero CommuteSync",
            "qr_payload":         f"CS:{booking_id}:{payload.option_id[:8]}",
            "modality_type":      modality,
            "title":              title,
            "subtitle":           subtitle,
            "origin":             "Trento",
            "destination":        dest["display"],
            "detail_lines":       detail_lines,
            "route_waypoints":    dest["route_waypoints"],
            "destination_coords": dest["coords"],
        },
    }
