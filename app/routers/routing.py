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

from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from rapidfuzz import fuzz, process, utils

from app import osrm, trains
from app.geocode import geocode
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
# Searchable place catalogue — every named mobility resource, so the user can
# pick a routing destination by typing instead of tapping the map.
# ---------------------------------------------------------------------------

# Each entry: {"name", "category", "lat", "lng", "detail"}.
_PLACES: list[dict[str, Any]] = []


def _build_places() -> None:
    seen: set[str] = set()

    def add(name: Any, category: str, lat: float, lng: float, detail: str) -> None:
        if not name:
            return
        label = str(name).strip()
        key = label.lower()
        if not label or key in seen:
            return
        seen.add(key)
        _PLACES.append({
            "name": label, "category": category,
            "lat": lat, "lng": lng, "detail": detail,
        })

    try:
        for f in transit.get_bus_stops()["features"]:
            c, p = f["geometry"]["coordinates"], f["properties"]
            routes = (p.get("routes") or "").strip()
            add(p.get("nome"), "busstop", c[1], c[0],
                f"Linee {routes}" if routes else "Fermata bus")
    except Exception:
        pass

    try:
        for f in mobility.get_stations()["features"]:
            c, p = f["geometry"]["coordinates"], f["properties"]
            add(p.get("name"), "station", c[1], c[0], p.get("tratta") or "Stazione")
    except Exception:
        pass

    try:
        for f in mobility.get_carsharing()["features"]:
            c, p = f["geometry"]["coordinates"], f["properties"]
            add(p.get("via"), "carsharing", c[1], c[0], "Car sharing")
    except Exception:
        pass

    try:
        for f in mobility.get_taxi()["features"]:
            c, p = f["geometry"]["coordinates"], f["properties"]
            add(p.get("name"), "taxi", c[1], c[0], p.get("address") or "Posteggio taxi")
    except Exception:
        pass

    try:
        for f in mobility.get_parking()["features"]:
            rings = f["geometry"]["coordinates"]
            if not rings or not rings[0]:
                continue
            ext, p = rings[0], f["properties"]
            add(p.get("descrizione") or p.get("zona"), "parking",
                sum(x[1] for x in ext) / len(ext),
                sum(x[0] for x in ext) / len(ext),
                "Parcheggio")
    except Exception:
        pass


_build_places()


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


def resolve_place(query: str) -> dict[str, Any] | None:
    """Resolve a free-text place to ``{lat, lng, name, category}``.

    The city's named mobility resources are matched first (a tight fuzzy cutoff
    so only a near-exact name wins); anything else is handed to the address
    geocoder, so the user can route to any street or landmark in the region.
    """
    q = (query or "").strip()
    if len(q) < 2:
        return None

    if _PLACES:
        choices = {i: p["name"] for i, p in enumerate(_PLACES)}
        match = process.extractOne(
            q, choices, scorer=fuzz.WRatio,
            processor=utils.default_process, score_cutoff=88,
        )
        if match is not None:
            p = _PLACES[match[2]]
            return {
                "lat": p["lat"], "lng": p["lng"],
                "name": p["name"], "category": p["category"],
            }

    return geocode(q)


def _resolve_destination(payload: RoutePayload) -> dict[str, Any]:
    """Turn the payload's destination into concrete {lat, lng, name}."""
    if payload.destination_coords is not None:
        return {
            "lat":  payload.destination_coords.lat,
            "lng":  payload.destination_coords.lng,
            "name": payload.destination or "Destinazione",
            "category": "address",
        }

    if payload.destination:
        place = resolve_place(payload.destination)
        if place is not None:
            return place

    raise HTTPException(
        status_code=404,
        detail="Non ho trovato questa destinazione a Trento o Rovereto. "
               "Prova con un indirizzo o un nome più preciso.",
    )


def _leg(
    mode: str,
    frm: dict[str, Any],
    to: dict[str, Any],
    *,
    label_from: str,
    label_to: str,
    overhead_min: float = 0.0,
    line_name: str | None = None,
) -> dict[str, Any]:
    """One route segment: distance, duration and a [lng, lat] polyline."""
    dist = haversine_m(frm["lat"], frm["lng"], to["lat"], to["lng"])
    duration = dist / SPEED[mode] + overhead_min
    leg_dict = {
        "mode":         mode,
        "from":         {"name": label_from, "lat": frm["lat"], "lng": frm["lng"]},
        "to":           {"name": label_to,   "lat": to["lat"],  "lng": to["lng"]},
        "distance_m":   round(dist),
        "duration_min": round(duration, 1),
        "polyline":     [[frm["lng"], frm["lat"]], [to["lng"], to["lat"]]],
    }
    if line_name is not None:
        leg_dict["line_name"] = line_name
    return leg_dict


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


def _enrich_legs_by_mode(
    suggestions: list[dict[str, Any]],
    modes: set[str],
    fetcher,
) -> None:
    """Replace straight-line polylines with real route geometry for the given modes."""
    jobs: dict[tuple[float, float, float, float], list[dict[str, Any]]] = {}
    for s in suggestions:
        for leg in s["legs"]:
            if leg["mode"] not in modes:
                continue
            frm, to = leg["from"], leg["to"]
            key = (
                round(frm["lat"], 5), round(frm["lng"], 5),
                round(to["lat"], 5), round(to["lng"], 5),
            )
            jobs.setdefault(key, []).append(leg)

    if not jobs:
        return

    def fetch(key: tuple[float, float, float, float]):
        return key, fetcher(*key)

    with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as pool:
        for key, geom in pool.map(fetch, list(jobs.keys())):
            if geom is None:
                continue
            for leg in jobs[key]:
                leg["polyline"]     = geom["polyline"]
                leg["distance_m"]   = round(geom["distance_m"])
                leg["duration_min"] = round(geom["duration_min"], 1)


def _enrich_walk_legs(suggestions: list[dict[str, Any]]) -> None:
    _enrich_legs_by_mode(suggestions, {"walk"}, osrm.walk_route)


def _enrich_drive_legs(suggestions: list[dict[str, Any]]) -> None:
    _enrich_legs_by_mode(suggestions, {"drive", "taxi"}, osrm.drive_route)


# ---------------------------------------------------------------------------
# Itinerary builders
# ---------------------------------------------------------------------------


def _train_leg(o_st: dict[str, Any], d_st: dict[str, Any], leg: dict[str, Any],
               extra_min: float = 0.0) -> dict[str, Any]:
    """A single train segment between two stations, in route-leg shape."""
    line_name = trains.get_upcoming_train_info(o_st["code"], d_st["code"])
    leg_dict = {
        "mode":         "train",
        "from":         {"name": o_st["name"], "lat": o_st["lat"], "lng": o_st["lng"]},
        "to":           {"name": d_st["name"], "lat": d_st["lat"], "lng": d_st["lng"]},
        "distance_m":   leg["distance_m"],
        "duration_min": round(leg["duration_min"] + extra_min, 1),
        "polyline":     leg["polyline"],
    }
    if line_name:
        leg_dict["line_name"] = line_name
    return leg_dict


def _build_train(origin: dict[str, Any], dest: dict[str, Any]) -> dict[str, Any] | None:
    """Walk → regional train → walk, or None when no line serves the trip."""
    leg = trains.plan_train_leg(origin["lat"], origin["lng"], dest["lat"], dest["lng"])
    if leg is None:
        return None
    o_st, d_st = leg["origin_station"], leg["dest_station"]
    here = "La tua posizione"
    legs = [
        _leg("walk", origin, o_st, label_from=here, label_to=o_st["name"]),
        _train_leg(o_st, d_st, leg),
        _leg("walk", d_st, dest, label_from=d_st["name"], label_to=dest["name"]),
    ]
    return _suggestion(
        "train", "Treno", "🚆",
        f"Treno da {o_st['name']} a {d_st['name']}",
        legs, leg["fare_eur"],
    )


def _build_park_ride(origin: dict[str, Any], dest: dict[str, Any]) -> dict[str, Any] | None:
    """Drive → park at a station → train → walk: the flagship park-and-ride trip.

    The car is left at the parking lot nearest the boarding station, so the
    congested city centre is reached by rail instead of by car.
    """
    leg = trains.plan_train_leg(origin["lat"], origin["lng"], dest["lat"], dest["lng"])
    if leg is None:
        return None
    o_st, d_st = leg["origin_station"], leg["dest_station"]
    park = _nearest(o_st, _PARKING)
    if park is None:
        return None
    here = "La tua posizione"
    legs = [
        _leg("drive", origin, park, label_from=f"{here} (auto)",
             label_to=park["name"], overhead_min=1.0),
        _leg("walk", park, o_st, label_from=park["name"], label_to=o_st["name"]),
        # +3 min for parking the car and reaching the platform.
        _train_leg(o_st, d_st, leg, extra_min=3.0),
        _leg("walk", d_st, dest, label_from=d_st["name"], label_to=dest["name"]),
    ]
    return _suggestion(
        "park_ride", "Park & Ride", "🅿️🚆",
        f"Parcheggia a {park['name']}, poi treno da {o_st['name']}",
        legs, 2.00 + leg["fare_eur"],
    )


def _build_suggestions(origin: dict[str, Any], dest: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    here = "La tua posizione"

    straight_m = haversine_m(origin["lat"], origin["lng"], dest["lat"], dest["lng"])

    # 1. Walk — always available.
    walk = _leg("walk", origin, dest, label_from=here, label_to=dest["name"])
    out.append(_suggestion(
        "walk", "A piedi", "🚶",
        f"Cammina {_fmt_dist(walk['distance_m'])} fino a {dest['name']}",
        [walk], 0.0,
    ))

    # 2. Transit — walk to nearest stop, ride the bus, walk from the stop near D.
    #    Only add when the bus leg is in the right direction (destination stop is
    #    closer to the destination than to the origin) and actually saves time.
    o_stop = _nearest(origin, _BUS_STOPS)
    d_stop = _nearest(dest, _BUS_STOPS)
    if o_stop and d_stop and o_stop["id"] != d_stop["id"]:
        walk_to_stop_m = haversine_m(origin["lat"], origin["lng"], o_stop["lat"], o_stop["lng"])
        walk_from_stop_m = haversine_m(d_stop["lat"], d_stop["lng"], dest["lat"], dest["lng"])
        # Skip if the walk to/from stops alone is longer than just walking to the destination,
        # or if both stops are basically at the same location as origin/destination.
        if walk_to_stop_m + walk_from_stop_m < straight_m * 1.4:
            o_stop_id = o_stop.get("id")
            d_stop_id = d_stop.get("id")
            o_routes = transit._STOP_ROUTES.get(o_stop_id, set()) if o_stop_id else set()
            d_routes = transit._STOP_ROUTES.get(d_stop_id, set()) if d_stop_id else set()
            connecting = o_routes & d_routes
            
            display_routes = connecting if connecting else o_routes
            if display_routes:
                sorted_routes = sorted(display_routes, key=transit._route_sort_key)
                if len(sorted_routes) == 1:
                    bus_line_name = f"Linea {sorted_routes[0]}"
                    summary_line = f"Bus {sorted_routes[0]}"
                else:
                    bus_line_name = f"Linee {', '.join(sorted_routes)}"
                    summary_line = f"Bus {', '.join(sorted_routes)}"
            else:
                bus_line_name = "Bus"
                summary_line = "Bus"

            legs = [
                _leg("walk", origin, o_stop, label_from=here, label_to=o_stop["name"]),
                _leg("bus", o_stop, d_stop, label_from=o_stop["name"],
                     label_to=d_stop["name"], overhead_min=6.0, line_name=bus_line_name),
                _leg("walk", d_stop, dest, label_from=d_stop["name"], label_to=dest["name"]),
            ]
            out.append(_suggestion(
                "transit", "Bus urbano", "🚌",
                f"{summary_line} da {o_stop['name']}",
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

    # 6. Train — walk to the line, ride, walk off, whenever rail serves the trip.
    train = _build_train(origin, dest)
    if train is not None:
        out.append(train)

    # 7. Park & Ride — drive, park at the station, finish by train. The product's
    #    flagship: only surface it when the trip is long enough for it to make
    #    sense (> 4 km straight-line — intra-city trips don't need park+train).
    park_ride = _build_park_ride(origin, dest) if straight_m >= 4_000 else None
    if park_ride is not None:
        out.append(park_ride)

    # Upgrade walking and driving legs to real road/pavement geometry, then
    # recompute totals so the ranking reflects on-street distances.
    _enrich_walk_legs(out)
    _enrich_drive_legs(out)
    for s in out:
        s["total_distance_m"] = sum(leg["distance_m"] for leg in s["legs"])
        s["total_duration_min"] = round(
            sum(leg["duration_min"] for leg in s["legs"]), 1
        )

    # Drop drive-and-park itineraries that would still leave an unrealistic
    # walk (> 3 km) — it means no parking or car-share sits near the
    # destination, so the option is not actually viable. "A piedi" is exempt:
    # one long walking leg is the whole point of it.
    def _viable(s: dict[str, Any]) -> bool:
        if s["id"] == "walk":
            return True
        return all(
            not (leg["mode"] == "walk" and leg["distance_m"] > 3000)
            for leg in s["legs"]
        )

    out = [s for s in out if _viable(s)]

    # Rank by total travel time.
    out.sort(key=lambda s: s["total_duration_min"])

    # Promote Park & Ride to the top only when it's actually competitive —
    # within 50 % of the fastest option (avoids surfacing it over a 5-min walk).
    if park_ride is not None and park_ride in out:
        fastest_min = out[0]["total_duration_min"]
        if park_ride["total_duration_min"] <= fastest_min * 1.5:
            out.remove(park_ride)
            out.insert(0, park_ride)

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


@router.get("/search")
def search_places(q: str, limit: int = 8) -> dict[str, Any]:
    """Fuzzy-search the catalogue of named mobility resources for a destination."""
    query = (q or "").strip()
    if len(query) < 2:
        return {"results": []}

    limit = max(1, min(limit, 15))
    choices = {i: place["name"] for i, place in enumerate(_PLACES)}
    matches = process.extract(
        query, choices, scorer=fuzz.WRatio, limit=limit, score_cutoff=55
    )
    return {
        "results": [
            {**_PLACES[idx], "score": round(score)}
            for _, score, idx in matches
        ]
    }
