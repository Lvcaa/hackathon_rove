"""
Trips router — Discovery → Commit two-phase booking flow.

POST /api/trips/search  →  returns an array of bookable modalities, each with
                           its own unique option_id and per-resource snapshot.
POST /api/trips/book    →  atomically locks the specific chosen modality and
                           returns a generalised boarding pass.
GET  /api/trips         →  list all persisted bookings (most recent first).
GET  /api/trips/{id}    →  retrieve a single booking by id.
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

from app.database import get_db

router = APIRouter(prefix="/api/trips", tags=["trips"])

# ---------------------------------------------------------------------------
# In-memory resource state (row-level locking via threading.Lock)
# ---------------------------------------------------------------------------

_lock = Lock()

# option_id → {status, modality, dest_key, expires_at, zone_id}
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
    """Logistics (track, platform, route) for a destination.

    Known stations carry their own data; any other address rides the default
    station hub — the boarding pass keeps the real destination name via the
    option's ``display`` field, set at search time.
    """
    return _DESTINATIONS.get(raw.strip().lower()) or _DESTINATIONS[_DEFAULT_DEST_KEY]


def _seat(option_id: str) -> str:
    digest = int(hashlib.sha256(option_id.encode()).hexdigest(), 16)
    return f"{(digest % 28) + 1}{['A', 'B', 'C', 'D'][(digest >> 8) % 4]}"


def _parking_spot(booking_id: str) -> str:
    return f"A{abs(hash(booking_id)) % 60 + 1}"


def _reg_number(booking_id: str) -> str:
    return f"REG {2380 + abs(hash(booking_id)) % 50}"


def _new_option(
    dest_key: str,
    modality: str,
    expires_at: str,
    zone_id: str | None = None,
    display: str | None = None,
) -> str:
    oid = str(uuid.uuid4())
    _OPTIONS[oid] = {
        "status":     "PENDING",
        "modality":   modality,
        "dest_key":   dest_key,
        "expires_at": expires_at,
        "zone_id":    zone_id,
        "display":    display,
    }
    return oid


def _nearest_parking_zone(dest_lng: float, dest_lat: float) -> dict | None:
    """Return the nearest configured parking zone row from the DB, or None."""
    with get_db() as conn:
        return conn.execute(
            """SELECT id, available_spots, max_capacity FROM parking_zones
               WHERE max_capacity > 0
               ORDER BY ((centroid_lat - ?) * (centroid_lat - ?) + (centroid_lng - ?) * (centroid_lng - ?))
               LIMIT 1""",
            (dest_lat, dest_lat, dest_lng, dest_lng),
        ).fetchone()


# ---------------------------------------------------------------------------
# Internal business logic (callable without HTTP or artificial delays)
# ---------------------------------------------------------------------------


def _run_search_logic(destination: str) -> dict[str, Any]:
    dest     = _resolve_dest(destination)
    dest_key = destination.strip().lower()
    # Preserve the destination the user actually typed for the boarding pass —
    # known stations keep their canonical name, any other address keeps its own.
    display  = dest["display"] if dest_key in _DESTINATIONS else (destination.strip() or dest["display"])
    now      = _now_utc()
    expires_at = _iso(now + timedelta(minutes=10))

    # Query DB for the nearest configured parking zone (live availability).
    dest_lng, dest_lat = dest["coords"]
    db_park = _nearest_parking_zone(dest_lng, dest_lat)

    with _lock:
        train_avail = _RESOURCES["train_seats"]["available"]
        train_total = _RESOURCES["train_seats"]["total"]
        bike_avail  = _RESOURCES["bike_stazione"]["available_bikes"]
        bike_docks  = _RESOURCES["bike_stazione"]["available_docks"]

        if db_park:
            park_avail   = db_park["available_spots"]
            park_total   = db_park["max_capacity"]
            park_zone_id = db_park["id"]
        else:
            park_avail   = _RESOURCES["parking_stazione"]["available"]
            park_total   = _RESOURCES["parking_stazione"]["total"]
            park_zone_id = None

        train_oid = _new_option(dest_key, "train",        expires_at, display=display)
        park_oid  = _new_option(dest_key, "parking",      expires_at, zone_id=park_zone_id, display=display)
        taxi_oid  = _new_option(dest_key, "taxi",         expires_at, display=display)
        bike_oid  = _new_option(dest_key, "bike_sharing", expires_at, display=display)

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
        "destination":        display,
        "destination_coords": dest["coords"],
        "route_waypoints":    dest["route_waypoints"],
        "modalities":         modalities,
    }


def _run_book_logic(option_id: str) -> dict[str, Any]:
    with _lock:
        option = _OPTIONS.get(option_id)

        if option is None:
            raise HTTPException(status_code=404, detail="option_id not found or expired")
        if option["status"] == "BOOKED":
            raise HTTPException(status_code=409, detail="Already booked — resource conflict")

        # Lazy expiry: check wall-clock time against the stored expires_at.
        if option["status"] == "PENDING":
            try:
                if _now_utc() > datetime.fromisoformat(option["expires_at"]):
                    option["status"] = "EXPIRED"
            except (ValueError, TypeError):
                pass

        if option["status"] == "EXPIRED":
            raise HTTPException(status_code=410, detail="Option window expired")

        option["status"] = "BOOKED"
        modality = option["modality"]
        zone_id  = option.get("zone_id")

        updated_available_spots: int | None = None
        if modality == "train":
            _RESOURCES["train_seats"]["available"] = max(
                0, _RESOURCES["train_seats"]["available"] - 1
            )
        elif modality == "parking":
            _RESOURCES["parking_stazione"]["available"] = max(
                0, _RESOURCES["parking_stazione"]["available"] - 1
            )
            updated_available_spots = _RESOURCES["parking_stazione"]["available"]
        elif modality == "bike_sharing":
            _RESOURCES["bike_stazione"]["available_bikes"] = max(
                0, _RESOURCES["bike_stazione"]["available_bikes"] - 1
            )

    dest       = _resolve_dest(option["dest_key"])
    display    = option.get("display") or dest["display"]
    booking_id = f"CS-{str(uuid.uuid4())[:8].upper()}"
    now_iso    = _iso(_now_utc())

    # Mirror parking decrement to the DB (uses the zone snapshotted at search time).
    if modality == "parking":
        if zone_id:
            with get_db() as conn:
                conn.execute(
                    "UPDATE parking_zones SET available_spots = MAX(0, available_spots - 1), updated_at = ? WHERE id = ?",
                    (now_iso, zone_id),
                )
        else:
            dest_lng, dest_lat = dest["coords"]
            with get_db() as conn:
                row = conn.execute(
                    """SELECT id FROM parking_zones WHERE max_capacity > 0 AND available_spots > 0
                       ORDER BY ((centroid_lat - ?) * (centroid_lat - ?) + (centroid_lng - ?) * (centroid_lng - ?))
                       LIMIT 1""",
                    (dest_lat, dest_lat, dest_lng, dest_lng),
                ).fetchone()
                if row:
                    zone_id = row["id"]
                    conn.execute(
                        "UPDATE parking_zones SET available_spots = MAX(0, available_spots - 1), updated_at = ? WHERE id = ?",
                        (now_iso, zone_id),
                    )


    if modality == "train":
        title    = _reg_number(booking_id)
        subtitle = f"Binario {dest['platform']} · Posto {_seat(option_id)}"
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
    else:
        bike_id = f"BIKE-{abs(hash(booking_id)) % 900 + 100}"
        title    = "Bike Sharing"
        subtitle = f"Stazione FS · Bici {bike_id}"
        detail_lines = [
            {"label": "ID bici",          "value": bike_id},
            {"label": "Codice sblocco",   "value": f"{abs(hash(booking_id)) % 9000 + 1000}"},
            {"label": "Stazione",         "value": "Bike Sharing – Stazione"},
            {"label": "Tariffa",          "value": "€ 1,00 / 30 min"},
        ]

    # Persist the booking to the DB.
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO trips (id, destination_name, parking_id, status, created_at) VALUES (?,?,?,?,?)",
            (booking_id, display, zone_id if modality == "parking" else None, "confirmed", now_iso),
        )
        for i, line in enumerate(detail_lines):
            conn.execute(
                "INSERT INTO trip_steps (trip_id, step_order, action, detail) VALUES (?,?,?,?)",
                (booking_id, i, line["label"], line["value"]),
            )

    return {
        "booking_id":              booking_id,
        "option_id":               option_id,
        "modality_type":           modality,
        "status":                  "BOOKED",
        "confirmed_at":            now_iso,
        "updated_available_spots": updated_available_spots,
        "boarding_pass": {
            "booking_id":         booking_id,
            "passenger":          "Passeggero CommuteSync",
            "qr_payload":         f"CS:{booking_id}:{option_id[:8]}",
            "modality_type":      modality,
            "title":              title,
            "subtitle":           subtitle,
            "origin":             "Trento",
            "destination":        display,
            "detail_lines":       detail_lines,
            "route_waypoints":    dest["route_waypoints"],
            "destination_coords": dest["coords"],
        },
    }


# ---------------------------------------------------------------------------
# /search — Discovery phase
# ---------------------------------------------------------------------------


@router.post("/search")
async def search_trips(payload: SearchPayload) -> dict[str, Any]:
    await asyncio.sleep(0.6)
    return _run_search_logic(payload.destination)


# ---------------------------------------------------------------------------
# /book — Commit phase
# ---------------------------------------------------------------------------


@router.post("/book")
async def book_trip(payload: BookPayload) -> dict[str, Any]:
    await asyncio.sleep(0.4)
    return _run_book_logic(payload.option_id)


# ---------------------------------------------------------------------------
# Booking retrieval
# ---------------------------------------------------------------------------


@router.get("")
def list_trips(limit: int = 20) -> dict[str, Any]:
    """List all confirmed bookings, most recent first."""
    limit = max(1, min(limit, 100))
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, destination_name, parking_id, status, created_at FROM trips ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {
        "trips": [
            {
                "booking_id":       r["id"],
                "destination_name": r["destination_name"],
                "parking_id":       r["parking_id"],
                "status":           r["status"],
                "created_at":       r["created_at"],
            }
            for r in rows
        ]
    }


@router.get("/{booking_id}")
def get_trip(booking_id: str) -> dict[str, Any]:
    """Retrieve a single booking and its detail steps by booking id."""
    with get_db() as conn:
        trip = conn.execute(
            "SELECT id, destination_name, parking_id, status, created_at FROM trips WHERE id = ?",
            (booking_id,),
        ).fetchone()
        if not trip:
            raise HTTPException(status_code=404, detail="Booking not found")
        steps = conn.execute(
            "SELECT action, detail FROM trip_steps WHERE trip_id = ? ORDER BY step_order",
            (booking_id,),
        ).fetchall()
    return {
        "booking_id":       trip["id"],
        "destination_name": trip["destination_name"],
        "parking_id":       trip["parking_id"],
        "status":           trip["status"],
        "created_at":       trip["created_at"],
        "detail_lines":     [{"label": s["action"], "value": s["detail"]} for s in steps],
    }
