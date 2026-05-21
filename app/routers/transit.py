"""
Transit router — Trentino Trasporti GTFS (urban network of Trento).

The official GTFS feed is downloaded once, parsed into in-memory indexes at
module import time, and exposed as bus stops, routes, and per-stop departure
boards. All endpoints answer from memory so responses are instant.
"""

from __future__ import annotations

import csv
import datetime
import io
import zipfile
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from fastapi import APIRouter

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

GTFS_DIR = Path(__file__).parent.parent.parent / "dataset" / "gtfs"

# Trentino Trasporti publishes two GTFS feeds: the Trento urban network and the
# extraurban (suburban/valley) network. Both are merged so each bus stop can be
# tagged urban vs extraurban.
GTFS_FEEDS: list[tuple[str, str, Path]] = [
    ("urban",
     "https://www.trentinotrasporti.it/opendata/google_transit_urbano_tte.zip",
     GTFS_DIR / "urbano_tte.zip"),
    ("extraurban",
     "https://www.trentinotrasporti.it/opendata/google_transit_extraurbano_tte.zip",
     GTFS_DIR / "extraurbano_tte.zip"),
]
ROME = ZoneInfo("Europe/Rome")

router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory indexes (populated once by _build)
# ---------------------------------------------------------------------------

# route_id -> {short, long, color, text_color}
_ROUTES: dict[str, dict] = {}
# stop_id  -> {name, code, lat, lon}
_STOPS: dict[str, dict] = {}
# stop_id  -> sorted list of (dep_sec, route_id, headsign, service_id)
_STOP_SCHEDULE: dict[str, list[tuple[int, str, str, str]]] = {}
# stop_id  -> set of route short names serving it
_STOP_ROUTES: dict[str, set[str]] = {}
# [{id, days: [7 bools, Mon..Sun], start: "YYYYMMDD", end: "YYYYMMDD"}]
_CALENDAR: list[dict] = []
# "YYYYMMDD" -> [(service_id, exception_type)]
_CAL_DATES: dict[str, list[tuple[str, str]]] = {}
# "YYYYMMDD" -> set of service ids active that day (lazily computed)
_ACTIVE_CACHE: dict[str, set[str]] = {}

_GTFS_OK = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _gtfs_time_to_sec(value: str) -> int:
    """GTFS clock time → seconds since midnight (values may exceed 24:00:00)."""
    h, m, s = value.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def _sec_to_hhmm(sec: int) -> str:
    """Seconds since midnight → 'HH:MM' (wraps past-midnight times)."""
    return f"{(sec // 3600) % 24:02d}:{(sec // 60) % 60:02d}"


def _route_sort_key(name: str) -> tuple[int, object]:
    """Sort routes numerically when possible ('2' before '13'), letters last."""
    digits = "".join(c for c in name if c.isdigit())
    if name[:1].isdigit() and digits:
        return (0, int(digits))
    return (1, name)


def _read_rows(zf: zipfile.ZipFile, name: str):
    """Yield dict rows from a CSV inside the GTFS zip (handles UTF-8 BOM)."""
    with zf.open(name) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        yield from csv.DictReader(text)


def _ensure_zip(url: str, path: Path) -> None:
    """Download a GTFS feed once; reuse the cached copy on later starts."""
    if path.exists():
        return
    GTFS_DIR.mkdir(parents=True, exist_ok=True)
    resp = requests.get(
        url,
        headers={"User-Agent": "CommuteSync Hackathon/1.0"},
        timeout=120,
    )
    resp.raise_for_status()
    path.write_bytes(resp.content)


# ---------------------------------------------------------------------------
# Build (runs once at import time)
# ---------------------------------------------------------------------------

def _build_feed(kind: str, zip_path: Path) -> None:
    """Parse one GTFS feed into the shared in-memory indexes.

    Every id is namespaced with the feed kind (``"urban:"`` / ``"extraurban:"``)
    so the two feeds can coexist without route/stop/service id collisions.
    """
    pre = f"{kind}:"
    with zipfile.ZipFile(zip_path) as zf:
        for r in _read_rows(zf, "routes.txt"):
            _ROUTES[pre + r["route_id"]] = {
                "short": (r.get("route_short_name") or "").strip(),
                "long": (r.get("route_long_name") or "").strip(),
                "color": (r.get("route_color") or "").strip() or "f97316",
                "text_color": (r.get("route_text_color") or "").strip() or "ffffff",
            }

        for s in _read_rows(zf, "stops.txt"):
            try:
                lat = float(s["stop_lat"])
                lon = float(s["stop_lon"])
            except (ValueError, KeyError, TypeError):
                continue
            _STOPS[pre + s["stop_id"]] = {
                "name": (s.get("stop_name") or "Fermata").strip(),
                "code": (s.get("stop_code") or "").strip(),
                "lat": lat,
                "lon": lon,
                "kind": kind,
            }

        trips: dict[str, dict] = {}
        for t in _read_rows(zf, "trips.txt"):
            trips[pre + t["trip_id"]] = {
                "route_id": pre + t["route_id"],
                "service_id": pre + t["service_id"],
                "headsign": (t.get("trip_headsign") or "").strip(),
            }

        for c in _read_rows(zf, "calendar.txt"):
            _CALENDAR.append({
                "id": pre + c["service_id"],
                "days": [
                    c["monday"] == "1", c["tuesday"] == "1", c["wednesday"] == "1",
                    c["thursday"] == "1", c["friday"] == "1", c["saturday"] == "1",
                    c["sunday"] == "1",
                ],
                "start": c["start_date"],
                "end": c["end_date"],
            })

        for cd in _read_rows(zf, "calendar_dates.txt"):
            _CAL_DATES.setdefault(cd["date"], []).append(
                (pre + cd["service_id"], cd["exception_type"])
            )

        for st in _read_rows(zf, "stop_times.txt"):
            trip = trips.get(pre + st["trip_id"])
            if trip is None:
                continue
            raw_time = st.get("departure_time") or st.get("arrival_time")
            if not raw_time:
                continue
            try:
                dep_sec = _gtfs_time_to_sec(raw_time)
            except ValueError:
                continue
            stop_id = pre + st["stop_id"]
            _STOP_SCHEDULE.setdefault(stop_id, []).append(
                (dep_sec, trip["route_id"], trip["headsign"], trip["service_id"])
            )
            route = _ROUTES.get(trip["route_id"])
            if route and route["short"]:
                _STOP_ROUTES.setdefault(stop_id, set()).add(route["short"])


def _build() -> None:
    global _GTFS_OK
    for kind, url, zip_path in GTFS_FEEDS:
        try:
            _ensure_zip(url, zip_path)
            _build_feed(kind, zip_path)
        except Exception:
            # A feed that fails to download or parse is skipped; the remaining
            # feed (and the frontend mock fallback) keep the app usable.
            continue

    for deps in _STOP_SCHEDULE.values():
        deps.sort(key=lambda d: d[0])

    _GTFS_OK = bool(_STOPS)


try:
    _build()
except Exception:
    # Network or parse failure — endpoints degrade to empty responses and the
    # frontend keeps its mock bus stops.
    _GTFS_OK = False


# ---------------------------------------------------------------------------
# Service-calendar resolution
# ---------------------------------------------------------------------------

def _active_services(day: datetime.date) -> set[str]:
    """Service ids running on a given date (weekly calendar + date exceptions)."""
    ymd = day.strftime("%Y%m%d")
    cached = _ACTIVE_CACHE.get(ymd)
    if cached is not None:
        return cached

    weekday = day.weekday()  # Monday = 0
    active: set[str] = set()
    for svc in _CALENDAR:
        if svc["start"] <= ymd <= svc["end"] and svc["days"][weekday]:
            active.add(svc["id"])
    for service_id, exc_type in _CAL_DATES.get(ymd, []):
        if exc_type == "1":      # service added on this date
            active.add(service_id)
        elif exc_type == "2":    # service removed on this date
            active.discard(service_id)

    _ACTIVE_CACHE[ymd] = active
    return active


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/api/busstops")
def get_bus_stops() -> dict:
    """GeoJSON FeatureCollection of bus stops served by Trentino Trasporti.

    Each stop carries a ``kind`` of ``"urban"`` or ``"extraurban"``.
    """
    features: list[dict] = []
    for stop_id, stop in _STOPS.items():
        if stop_id not in _STOP_SCHEDULE:
            continue
        routes = sorted(_STOP_ROUTES.get(stop_id, set()), key=_route_sort_key)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [stop["lon"], stop["lat"]]},
            "properties": {
                "stop_id": stop_id,
                "nome": stop["name"],
                "code": stop["code"],
                "kind": stop["kind"],
                "routes": " ".join(routes),
            },
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/api/routes")
def get_routes() -> list[dict]:
    """All urban bus lines with their official display colors."""
    seen: dict[str, dict] = {}
    for route in _ROUTES.values():
        short = route["short"]
        if short and short not in seen:
            seen[short] = {
                "route": short,
                "route_long": route["long"],
                "color": route["color"],
                "text_color": route["text_color"],
            }
    return sorted(seen.values(), key=lambda r: _route_sort_key(r["route"]))


@router.get("/api/busstops/{stop_id}/schedule")
def get_stop_schedule(
    stop_id: str,
    time: str | None = None,
    limit: int = 12,
) -> dict:
    """
    Scheduled departures from a stop at or after a reference time.

    `time` is an optional 'HH:MM' string; it defaults to the current time in
    Trento (Europe/Rome). Only trips whose service runs today are included.
    """
    now = datetime.datetime.now(ROME)
    day = now.date()

    ref_sec: int
    if time:
        try:
            hh, mm = time.split(":")
            ref_sec = int(hh) * 3600 + int(mm) * 60
        except (ValueError, AttributeError):
            ref_sec = now.hour * 3600 + now.minute * 60
            time = None
    else:
        ref_sec = now.hour * 3600 + now.minute * 60

    limit = max(1, min(limit, 30))
    stop = _STOPS.get(stop_id)
    departures: list[dict] = []

    if stop is not None:
        active = _active_services(day)
        for dep_sec, route_id, headsign, service_id in _STOP_SCHEDULE.get(stop_id, []):
            if dep_sec < ref_sec or service_id not in active:
                continue
            route = _ROUTES.get(route_id, {})
            departures.append({
                "time": _sec_to_hhmm(dep_sec),
                "route": route.get("short", "?"),
                "route_long": route.get("long", ""),
                "color": route.get("color", "f97316"),
                "text_color": route.get("text_color", "ffffff"),
                "headsign": headsign,
                "in_min": max(0, (dep_sec - ref_sec) // 60),
            })
            if len(departures) >= limit:
                break

    return {
        "stop_id": stop_id,
        "stop_name": stop["name"] if stop else "",
        "time": time or _sec_to_hhmm(ref_sec),
        "date": day.isoformat(),
        "departures": departures,
    }
