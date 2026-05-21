"""
Trentino Trasporti real-time bus tracking.

Uses the official `gtlservice` API (the one behind the "Muoversi in Trentino"
app). That API exposes, per running trip, the last detected stop, the delay,
and the schedule — but not raw GPS. Vehicle positions are therefore
reconstructed by interpolating along the trip's stop sequence, exactly the way
the official app does it.

A background thread re-polls every route's trips every few seconds; positions
are recomputed from the cached trips on each `get_live_buses()` call so buses
keep gliding between API refreshes.
"""

from __future__ import annotations

import datetime
import math
import threading
import time as _time
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_BASE = "https://app-tpl.tndigit.it/gtlservice"
_AUTH = ("mittmobile", "ecGsp.RHB3")  # public credentials used by the TT app
_HEADERS = {"X-Requested-With": "it.tndigit.mit", "User-Agent": "CommuteSync/1.0"}
_ROME = ZoneInfo("Europe/Rome")

_TRIPS_REFRESH_SEC = 25     # how often the background thread re-polls trips
_STALE_EVENT_SEC = 1200     # drop trips whose last GPS event is older than this
_TRIP_WORKERS = 24          # parallel requests when polling all routes
_ROUTETYPE_BUS = 3          # GTFS route_type for buses (2=rail, 5=cable car)

# ---------------------------------------------------------------------------
# State (filled by the background thread)
# ---------------------------------------------------------------------------

_session = requests.Session()
_lock = threading.Lock()

_routes: dict[int, dict] = {}                  # routeId -> {short, type, kind}
_stops: dict[int, tuple[float, float]] = {}    # stopId  -> (lat, lon)
_live_trips: list[dict] = []                   # raw trip dicts with live data
_started = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get(path: str, params: dict | None = None):
    resp = _session.get(
        f"{_BASE}{path}", params=params, auth=_AUTH, headers=_HEADERS, timeout=20
    )
    resp.raise_for_status()
    return resp.json()


def _gtfs_sec(value: str | None) -> int:
    """GTFS clock time ('HH:MM[:SS]') → seconds since midnight (hours may exceed 24)."""
    parts = (value or "").split(":")
    if len(parts) < 2:
        raise ValueError(f"bad GTFS time: {value!r}")
    h, m = int(parts[0]), int(parts[1])
    s = int(parts[2]) if len(parts) > 2 and parts[2] else 0
    return h * 3600 + m * 60 + s


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(d)))


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlon = math.radians(b[1] - a[1])
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _parse_event(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Reference data — routes and stops (refreshed rarely)
# ---------------------------------------------------------------------------

def _load_routes() -> None:
    global _routes
    routes: dict[int, dict] = {}
    for r in _get("/routes"):
        if r.get("routeType") != _ROUTETYPE_BUS:
            continue
        kind = "extraurban" if r.get("type") == "E" else "urban"
        routes[r["routeId"]] = {
            "short": (r.get("routeShortName") or str(r["routeId"])).strip(),
            "type": r.get("type", "U"),
            "kind": kind,
        }
    _routes = routes


def _load_stops() -> None:
    global _stops
    stops: dict[int, tuple[float, float]] = {}
    for s in _get("/stops", {"size": 20000}):
        try:
            stops[s["stopId"]] = (float(s["stopLat"]), float(s["stopLon"]))
        except (KeyError, TypeError, ValueError):
            continue
    _stops = stops


# ---------------------------------------------------------------------------
# Trip polling
# ---------------------------------------------------------------------------

def _in_service_window(trip: dict, now_sec: int) -> bool:
    """True if `now` falls between the trip's first departure and last arrival."""
    st = trip.get("stopTimes") or []
    if len(st) < 2:
        return False
    try:
        first = _gtfs_sec(st[0].get("departureTime") or st[0].get("arrivalTime"))
        last = _gtfs_sec(st[-1].get("arrivalTime") or st[-1].get("departureTime"))
    except (ValueError, AttributeError, TypeError):
        return False
    return first <= now_sec <= last


def _fetch_route_trips(route_id: int, info: dict, now_sec: int) -> list[dict]:
    """
    Trips currently in progress on a route — both GPS-tracked vehicles and
    scheduled trips that have no live signal (rendered later as on-time
    estimates). Each kept trip is tagged with `_routeId` and `_live`.
    """
    try:
        trips = _get(
            "/trips_new",
            {"routeId": route_id, "type": info["type"], "limit": 10},
        )
    except Exception:
        return []
    kept: list[dict] = []
    for t in trips:
        live = bool(t.get("matricolaBus") and t.get("lastEventRecivedAt"))
        if not live and not _in_service_window(t, now_sec):
            continue
        t["_routeId"] = route_id
        t["_live"] = live
        kept.append(t)
    return kept


def _refresh_trips() -> None:
    items = list(_routes.items())
    if not items:
        return
    now = datetime.datetime.now(_ROME)
    now_sec = now.hour * 3600 + now.minute * 60 + now.second
    collected: list[dict] = []
    with ThreadPoolExecutor(max_workers=_TRIP_WORKERS) as ex:
        for kept in ex.map(
            lambda kv: _fetch_route_trips(kv[0], kv[1], now_sec), items
        ):
            collected.extend(kept)
    with _lock:
        global _live_trips
        _live_trips = collected


# ---------------------------------------------------------------------------
# Position reconstruction
# ---------------------------------------------------------------------------

def _compute_position(trip: dict, now_sec: int, live: bool):
    """
    Place the bus along its stop sequence.

    For GPS-tracked trips the schedule is shifted by the reported `delay` and
    floored at the last physically detected stop. For scheduled-only trips
    (`live=False`) the bus is placed at its plain on-time position — an
    estimate of where it *should* be.
    """
    st = trip.get("stopTimes") or []
    if len(st) < 2:
        return None

    delay_sec = (trip.get("delay") or 0.0) * 60.0 if live else 0.0
    eff = now_sec - delay_sec  # where the bus should be on the unshifted schedule

    # Segment picked by the schedule estimate.
    seg = None
    for i in range(len(st) - 1):
        dep = _gtfs_sec(st[i].get("departureTime") or st[i].get("arrivalTime"))
        arr = _gtfs_sec(st[i + 1].get("arrivalTime") or st[i + 1].get("departureTime"))
        if dep <= eff <= arr:
            seg = i
            break
    if seg is None:
        first = _gtfs_sec(st[0].get("departureTime") or st[0].get("arrivalTime"))
        seg = 0 if eff < first else len(st) - 2

    # Floor at the last physically detected stop (GPS-tracked trips only).
    if live:
        last_seq = trip.get("lastSequenceDetection") or 0
        last_idx = next(
            (i for i, s in enumerate(st) if s.get("stopSequence") == last_seq), None
        )
        if last_idx is not None and seg < last_idx <= len(st) - 2:
            seg = last_idx

    a_stop, b_stop = st[seg], st[seg + 1]
    a = _stops.get(a_stop["stopId"])
    b = _stops.get(b_stop["stopId"])
    if a is None or b is None:
        return None

    t0 = _gtfs_sec(a_stop.get("departureTime") or a_stop.get("arrivalTime"))
    t1 = _gtfs_sec(b_stop.get("arrivalTime") or b_stop.get("departureTime"))
    frac = max(0.0, min(1.0, (eff - t0) / (t1 - t0))) if t1 > t0 else 0.0

    lat = a[0] + frac * (b[0] - a[0])
    lon = a[1] + frac * (b[1] - a[1])
    bearing = _bearing(a, b) if a != b else 0.0

    duration_h = max(t1 - t0, 1) / 3600.0
    speed = min(round(_haversine_km(a, b) / duration_h), 90)
    return lat, lon, bearing, speed


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_live_buses() -> dict:
    """
    GeoJSON FeatureCollection of buses currently in service. Features carry a
    `live` flag: true = real GPS position, false = on-time schedule estimate
    for a trip with no live signal (or one whose GPS feed has gone stale).
    """
    now = datetime.datetime.now(_ROME)
    now_sec = now.hour * 3600 + now.minute * 60 + now.second
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    with _lock:
        trips = list(_live_trips)

    features: list[dict] = []
    for trip in trips:
        live = bool(trip.get("_live"))
        if live:
            event = _parse_event(trip.get("lastEventRecivedAt"))
            if event and (now_utc - event).total_seconds() > _STALE_EVENT_SEC:
                live = False  # GPS feed went stale → fall back to a schedule estimate
        try:
            pos = _compute_position(trip, now_sec, live)
        except (ValueError, TypeError, AttributeError):
            pos = None  # malformed schedule data — skip this trip
        if pos is None:
            continue
        lat, lon, bearing, speed = pos
        info = _routes.get(trip.get("_routeId"), {})
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "id": f"trip-{trip.get('tripId')}",
                "route": info.get("short", "?"),
                "kind": info.get("kind", "urban"),
                "bearing": round(bearing),
                "speed": speed,
                "delay": round(trip.get("delay") or 0.0) if live else 0,
                "headsign": (trip.get("tripHeadsign") or "").strip(),
                "live": live,
            },
        })
    return {"type": "FeatureCollection", "features": features}


# ---------------------------------------------------------------------------
# Background refresher
# ---------------------------------------------------------------------------

def _worker() -> None:
    while True:
        try:
            if not _routes:
                _load_routes()
            if not _stops:
                _load_stops()
            _refresh_trips()
        except Exception:
            pass  # keep the last good cache; retry next cycle
        _time.sleep(_TRIPS_REFRESH_SEC)


def start() -> None:
    """Start the background polling thread once."""
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_worker, daemon=True, name="tt-realtime").start()
