"""
Routing router — origin-aware multimodal route suggestions.

Given the user's live position and a destination, this builds a set of ranked
end-to-end itineraries by chaining the city's mobility resources (transit,
parking, car-sharing, taxi). Each suggestion is a sequence of legs carrying a
mode, geometry, duration and cost — ready to draw on the map and, in a later
phase, feed straight into the trip booking flow.

POST /api/routing/suggest  →  ranked list of multimodal itineraries.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from rapidfuzz import fuzz, process

from app.database import get_db
from app.geo import haversine_m
from app.routers import mobility, transit

router = APIRouter(prefix="/api/routing", tags=["routing"])

# ---------------------------------------------------------------------------
# Travel model — average door-to-door speeds (metres per minute) and the
# fixed overhead each mode adds (waiting, parking, dispatch).
# ---------------------------------------------------------------------------

SPEED = {
    "walk":  80,    # ~4.8 km/h
    "bus":   300,   # ~18 km/h effective, incl. intermediate stops
    "drive": 400,   # ~24 km/h urban
    "taxi":  380,   # ~23 km/h urban
}

# ---------------------------------------------------------------------------
# Resource indexes — built once at import from the in-memory datasets
# ---------------------------------------------------------------------------

# Each entry: {"lat", "lng", "name"} (bus stops also carry "id").
_PARKING: list[dict[str, Any]] = []
_CARSHARE: list[dict[str, Any]] = []
_BUS_STOPS: list[dict[str, Any]] = []


def _build_indexes() -> None:
    """Populate the resource indexes from the cached mobility/transit data."""
    try:
        for f in mobility.get_parking()["features"]:
            rings = f["geometry"]["coordinates"]
            if not rings or not rings[0]:
                continue
            ext = rings[0]
            p = f["properties"]
            _PARKING.append({
                "lat": sum(c[1] for c in ext) / len(ext),
                "lng": sum(c[0] for c in ext) / len(ext),
                "name": p.get("descrizione") or p.get("zona") or "Parcheggio",
            })
    except Exception:
        pass

    try:
        for f in mobility.get_carsharing()["features"]:
            c = f["geometry"]["coordinates"]
            p = f["properties"]
            _CARSHARE.append({
                "lat": c[1], "lng": c[0],
                "name": p.get("via") or "Car sharing",
            })
    except Exception:
        pass

    try:
        for f in transit.get_bus_stops()["features"]:
            c = f["geometry"]["coordinates"]
            p = f["properties"]
            _BUS_STOPS.append({
                "lat": c[1], "lng": c[0],
                "name": p.get("nome") or "Fermata",
                "id": str(p.get("stop_id") or ""),
            })
    except Exception:
        pass


_build_indexes()


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class LatLng(BaseModel):
    lat: float
    lng: float


class RoutePayload(BaseModel):
    origin: LatLng
    destination: str | None = None
    destination_coords: LatLng | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _nearest(point: dict[str, Any], pool: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pool entry closest to `point` (by great-circle distance)."""
    best: dict[str, Any] | None = None
    best_d = float("inf")
    for cand in pool:
        d = haversine_m(point["lat"], point["lng"], cand["lat"], cand["lng"])
        if d < best_d:
            best_d, best = d, cand
    return best


def _fmt_dist(metres: float) -> str:
    return f"{metres / 1000:.1f} km" if metres >= 1000 else f"{round(metres)} m"


def _resolve_destination(payload: RoutePayload) -> dict[str, Any]:
    """Turn the payload's destination into concrete {lat, lng, name}."""
    if payload.destination_coords is not None:
        return {
            "lat":  payload.destination_coords.lat,
            "lng":  payload.destination_coords.lng,
            "name": payload.destination or "Destinazione",
        }

    if payload.destination:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT name, lat, lng FROM destinations WHERE lat IS NOT NULL"
            ).fetchall()
        if rows:
            choices = {i: r["name"] for i, r in enumerate(rows)}
            match = process.extractOne(
                payload.destination, choices, scorer=fuzz.WRatio, score_cutoff=60
            )
            if match is not None:
                r = rows[match[2]]
                return {"lat": r["lat"], "lng": r["lng"], "name": r["name"]}

    raise HTTPException(status_code=404, detail="Destinazione non trovata")


def _leg(
    mode: str,
    frm: dict[str, Any],
    to: dict[str, Any],
    *,
    label_from: str,
    label_to: str,
    overhead_min: float = 0.0,
) -> dict[str, Any]:
    """One route segment: distance, duration and a [lng, lat] polyline."""
    dist = haversine_m(frm["lat"], frm["lng"], to["lat"], to["lng"])
    duration = dist / SPEED[mode] + overhead_min
    return {
        "mode":         mode,
        "from":         {"name": label_from, "lat": frm["lat"], "lng": frm["lng"]},
        "to":           {"name": label_to,   "lat": to["lat"],  "lng": to["lng"]},
        "distance_m":   round(dist),
        "duration_min": round(duration, 1),
        "polyline":     [[frm["lng"], frm["lat"]], [to["lng"], to["lat"]]],
    }


def _suggestion(
    sid: str, label: str, icon: str, summary: str,
    legs: list[dict[str, Any]], cost_eur: float,
) -> dict[str, Any]:
    return {
        "id":                 sid,
        "label":              label,
        "icon":               icon,
        "summary":            summary,
        "total_distance_m":   sum(leg["distance_m"] for leg in legs),
        "total_duration_min": round(sum(leg["duration_min"] for leg in legs), 1),
        "cost_eur":           round(cost_eur, 2),
        "legs":               legs,
    }


# ---------------------------------------------------------------------------
# Itinerary builders
# ---------------------------------------------------------------------------


def _build_suggestions(origin: dict[str, Any], dest: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    here = "La tua posizione"

    # 1. Walk — always available.
    walk = _leg("walk", origin, dest, label_from=here, label_to=dest["name"])
    out.append(_suggestion(
        "walk", "A piedi", "🚶",
        f"Cammina {_fmt_dist(walk['distance_m'])} fino a {dest['name']}",
        [walk], 0.0,
    ))

    # 2. Transit — walk to nearest stop, ride the bus, walk from the stop near D.
    o_stop = _nearest(origin, _BUS_STOPS)
    d_stop = _nearest(dest, _BUS_STOPS)
    if o_stop and d_stop and o_stop["id"] != d_stop["id"]:
        legs = [
            _leg("walk", origin, o_stop, label_from=here, label_to=o_stop["name"]),
            _leg("bus", o_stop, d_stop, label_from=o_stop["name"],
                 label_to=d_stop["name"], overhead_min=6.0),
            _leg("walk", d_stop, dest, label_from=d_stop["name"], label_to=dest["name"]),
        ]
        out.append(_suggestion(
            "transit", "Bus urbano", "🚌",
            f"Bus dalla fermata {o_stop['name']}",
            legs, 1.50,
        ))

    # 3. Park & walk — drive your own car, park near D, finish on foot.
    d_park = _nearest(dest, _PARKING)
    if d_park:
        legs = [
            _leg("drive", origin, d_park, label_from=f"{here} (auto)",
                 label_to=d_park["name"], overhead_min=2.0),
            _leg("walk", d_park, dest, label_from=d_park["name"], label_to=dest["name"]),
        ]
        out.append(_suggestion(
            "park", "Auto + Parcheggio", "🅿️",
            f"Parcheggia a {d_park['name']}, poi a piedi",
            legs, 2.00,
        ))

    # 4. Car-share — walk to the nearest car, drive, park near D, walk.
    o_car = _nearest(origin, _CARSHARE)
    if o_car and d_park:
        legs = [
            _leg("walk", origin, o_car, label_from=here, label_to=o_car["name"]),
            _leg("drive", o_car, d_park, label_from=o_car["name"],
                 label_to=d_park["name"], overhead_min=1.0),
            _leg("walk", d_park, dest, label_from=d_park["name"], label_to=dest["name"]),
        ]
        drive_min = legs[1]["duration_min"]
        out.append(_suggestion(
            "carshare", "Car sharing", "🚗",
            f"Car sharing da {o_car['name']}",
            legs, 1.00 + drive_min * 0.30,
        ))

    # 5. Taxi — door-to-door, no walking.
    taxi = _leg("taxi", origin, dest, label_from=here,
                label_to=dest["name"], overhead_min=4.0)
    out.append(_suggestion(
        "taxi", "Taxi", "🚕",
        f"Taxi diretto a {dest['name']}",
        [taxi], 3.50 + taxi["distance_m"] / 1000 * 1.30,
    ))

    # Rank by total travel time; flag the fastest and the cheapest.
    out.sort(key=lambda s: s["total_duration_min"])
    cheapest = min(out, key=lambda s: s["cost_eur"])
    for i, s in enumerate(out):
        s["recommended"] = i == 0
        s["cheapest"] = s is cheapest
    return out


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/suggest")
def suggest_routes(payload: RoutePayload) -> dict[str, Any]:
    """Ranked multimodal itineraries from the user's live position to a destination."""
    origin = {
        "lat": payload.origin.lat,
        "lng": payload.origin.lng,
        "name": "La tua posizione",
    }
    dest = _resolve_destination(payload)

    return {
        "origin":          origin,
        "destination":     dest,
        "straight_line_m": round(
            haversine_m(origin["lat"], origin["lng"], dest["lat"], dest["lng"])
        ),
        "suggestions":     _build_suggestions(origin, dest),
    }
