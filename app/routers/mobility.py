"""
Mobility data router — serves GeoJSON FeatureCollections from CSV datasets.

All heavy work (CSV parsing, coordinate conversion) happens at module import
time so the data is cached in memory and endpoints return instantly.
"""

from __future__ import annotations

import math
import re
import time as _time
from pathlib import Path

import pandas as pd
import requests as _requests
from fastapi import APIRouter
from pyproj import Transformer
from shapely import wkt as shapely_wkt

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DATASET_DIR = Path(__file__).parent.parent.parent / "dataset"

# ---------------------------------------------------------------------------
# Coordinate transformer: UTM zone 32N → WGS84
# always_xy=True  →  transform(easting, northing) returns (lon, lat)
# ---------------------------------------------------------------------------

_transformer = Transformer.from_crs("EPSG:32632", "EPSG:4326", always_xy=True)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_POINT_RE = re.compile(r"POINT \(([0-9.]+) ([0-9.]+)\)")


def _utm_point_to_wgs84(wkt_text: str) -> tuple[float, float]:
    """Parse a WKT POINT in UTM 32N and return (lon, lat) in WGS84."""
    m = _POINT_RE.match(wkt_text.strip())
    if not m:
        raise ValueError(f"Cannot parse WKT point: {wkt_text!r}")
    easting = float(m.group(1))
    northing = float(m.group(2))
    lon, lat = _transformer.transform(easting, northing)
    return lon, lat


def _utm_polygon_to_wgs84_rings(wkt_text: str) -> list[list[list[float]]]:
    """
    Parse a WKT POLYGON in UTM 32N, convert every vertex to WGS84, and return
    the coordinate rings in GeoJSON format: [[[lon, lat], ...], ...].
    """
    geom = shapely_wkt.loads(wkt_text.strip())
    rings: list[list[list[float]]] = []

    # exterior ring
    exterior_coords: list[list[float]] = []
    for easting, northing in geom.exterior.coords:
        lon, lat = _transformer.transform(easting, northing)
        exterior_coords.append([lon, lat])
    rings.append(exterior_coords)

    # interior rings (holes), if any
    for interior in geom.interiors:
        hole_coords: list[list[float]] = []
        for easting, northing in interior.coords:
            lon, lat = _transformer.transform(easting, northing)
            hole_coords.append([lon, lat])
        rings.append(hole_coords)

    return rings


def _make_point_feature(lon: float, lat: float, properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat],
        },
        "properties": properties,
    }


def _make_polygon_feature(rings: list[list[list[float]]], properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": rings,
        },
        "properties": properties,
    }


def _feature_collection(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


# ---------------------------------------------------------------------------
# Data loading (runs once at import time)
# ---------------------------------------------------------------------------

def _load_stations() -> dict:
    df = pd.read_csv(DATASET_DIR / "stazioni.csv", sep=";")
    features: list[dict] = []
    for _, row in df.iterrows():
        try:
            lon, lat = _utm_point_to_wgs84(str(row["wkb_geometry"]))
        except ValueError:
            continue
        features.append(
            _make_point_feature(
                lon,
                lat,
                {
                    "name": str(row["nome"]) if pd.notna(row["nome"]) else None,
                    "tratta": str(row["tratta"]) if pd.notna(row["tratta"]) else None,
                },
            )
        )
    return _feature_collection(features)


def _load_taxi() -> dict:
    """Taxi CSV already has WGS84 columns x (lat) and y (lon)."""
    df = pd.read_csv(DATASET_DIR / "taxi.csv", sep=";")
    features: list[dict] = []
    for _, row in df.iterrows():
        try:
            lat = float(row["x"])
            lon = float(row["y"])
        except (ValueError, TypeError):
            continue
        features.append(
            _make_point_feature(
                lon,
                lat,
                {
                    "name": str(row["nome"]) if pd.notna(row["nome"]) else None,
                    "address": str(row["indirizzo"]) if pd.notna(row["indirizzo"]) else None,
                },
            )
        )
    return _feature_collection(features)


def _load_carsharing() -> dict:
    df = pd.read_csv(DATASET_DIR / "car_sharing.csv", sep=";")
    features: list[dict] = []
    for _, row in df.iterrows():
        try:
            lon, lat = _utm_point_to_wgs84(str(row["wkb_geometry"]))
        except ValueError:
            continue
        features.append(
            _make_point_feature(
                lon,
                lat,
                {
                    "via": str(row["via"]) if pd.notna(row["via"]) else None,
                    "auto": str(row["auto"]) if pd.notna(row["auto"]) else None,
                    "ordinanza": str(row["ordinanza"]) if pd.notna(row["ordinanza"]) else None,
                },
            )
        )
    return _feature_collection(features)


def _load_parking() -> dict:
    df = pd.read_csv(DATASET_DIR / "zone_parcheggio.csv", sep=";")
    features: list[dict] = []
    for _, row in df.iterrows():
        try:
            rings = _utm_polygon_to_wgs84_rings(str(row["wkb_geometry"]))
        except Exception:
            continue
        features.append(
            _make_polygon_feature(
                rings,
                {
                    "zona": str(row["zona"]) if pd.notna(row["zona"]) else None,
                    "descrizione": str(row["descrizione"]) if pd.notna(row["descrizione"]) else None,
                    "pianopark": int(row["pianopark"]) if pd.notna(row["pianopark"]) else None,
                },
            )
        )
    return _feature_collection(features)


# Module-level caches — populated once on first import
_STATIONS: dict = _load_stations()
_TAXI: dict = _load_taxi()
_CARSHARING: dict = _load_carsharing()
_PARKING: dict = _load_parking()

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter()


@router.get("/api/stations")
def get_stations() -> dict:
    """GeoJSON FeatureCollection of train/tram stations."""
    return _STATIONS


@router.get("/api/taxi")
def get_taxi() -> dict:
    """GeoJSON FeatureCollection of taxi stands."""
    return _TAXI


@router.get("/api/carsharing")
def get_carsharing() -> dict:
    """GeoJSON FeatureCollection of car-sharing spots."""
    return _CARSHARING


@router.get("/api/parking")
def get_parking() -> dict:
    """GeoJSON FeatureCollection of parking zones (Polygon features)."""
    return _PARKING


@router.get("/api/stats")
def get_stats() -> dict:
    """Quick summary of how many features are in each dataset."""
    return {
        "stations": len(_STATIONS["features"]),
        "taxi": len(_TAXI["features"]),
        "carsharing": len(_CARSHARING["features"]),
        "parking_zones": len(_PARKING["features"]),
    }


# ---------------------------------------------------------------------------
# Bus stops — Overpass API (cached 1 hour)
# ---------------------------------------------------------------------------

_busstops_cache: dict = {}
_busstops_cache_time: float = 0.0
_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_OVERPASS_QUERY = (
    '[out:json][timeout:25];'
    'node["highway"="bus_stop"](46.02,11.07,46.13,11.22);'
    'out body;'
)


def _fetch_bus_stops() -> dict:
    global _busstops_cache, _busstops_cache_time
    now = _time.time()
    if _busstops_cache and now - _busstops_cache_time < 3600:
        return _busstops_cache
    resp = _requests.post(
        _OVERPASS_URL,
        data={"data": _OVERPASS_QUERY},
        headers={"User-Agent": "CommuteSync Hackathon/1.0"},
        timeout=30,
    )
    resp.raise_for_status()
    raw = resp.json()
    features: list[dict] = []
    seen: set[str] = set()
    for el in raw.get("elements", []):
        lat, lon = el.get("lat"), el.get("lon")
        if lat is None or lon is None:
            continue
        key = f"{round(lat, 5)},{round(lon, 5)}"
        if key in seen:
            continue
        seen.add(key)
        tags = el.get("tags", {})
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "nome": tags.get("name", "Fermata bus"),
                "routes": tags.get("route_ref", ""),
                "ref": tags.get("ref", ""),
                "shelter": tags.get("shelter", "no"),
            },
        })
    result = {"type": "FeatureCollection", "features": features}
    _busstops_cache = result
    _busstops_cache_time = now
    return result


@router.get("/api/busstops")
def get_bus_stops() -> dict:
    """GeoJSON FeatureCollection of bus stops from OpenStreetMap (cached 1h)."""
    try:
        return _fetch_bus_stops()
    except Exception:
        return {"type": "FeatureCollection", "features": []}


# ---------------------------------------------------------------------------
# Live bus simulation (time-based positions along real Trento routes)
# ---------------------------------------------------------------------------

# Waypoints (lat, lon) for 4 main Trento bus lines
_ROUTES: dict[str, list[tuple[float, float]]] = {
    "5": [
        (46.108, 11.107), (46.098, 11.112), (46.088, 11.116),
        (46.079, 11.118), (46.072, 11.121), (46.066, 11.124),
        (46.059, 11.128), (46.052, 11.132),
    ],
    "B": [
        (46.071, 11.118), (46.073, 11.121), (46.071, 11.126),
        (46.068, 11.124), (46.066, 11.119), (46.068, 11.116),
        (46.071, 11.118),
    ],
    "13": [
        (46.072, 11.118), (46.071, 11.125), (46.070, 11.134),
        (46.069, 11.142), (46.067, 11.151), (46.066, 11.158),
    ],
    "8": [
        (46.072, 11.121), (46.076, 11.119), (46.082, 11.117),
        (46.090, 11.114), (46.097, 11.111),
    ],
}

_BUSES_PER_ROUTE = 3
_ROUTE_PERIOD = 600.0  # seconds for a full one-way trip


def _interpolate_route(
    waypoints: list[tuple[float, float]], t: float
) -> tuple[float, float, float]:
    """t in [0,1] → (lat, lon, bearing_degrees)."""
    if len(waypoints) < 2:
        return waypoints[0][0], waypoints[0][1], 0.0
    segs = [
        math.hypot(waypoints[i + 1][0] - waypoints[i][0],
                   waypoints[i + 1][1] - waypoints[i][1])
        for i in range(len(waypoints) - 1)
    ]
    total = sum(segs)
    target = t * total
    accum = 0.0
    for i, seg_len in enumerate(segs):
        if accum + seg_len >= target or i == len(segs) - 1:
            frac = ((target - accum) / seg_len) if seg_len > 0 else 0.0
            frac = max(0.0, min(1.0, frac))
            a, b = waypoints[i], waypoints[i + 1]
            lat = a[0] + frac * (b[0] - a[0])
            lon = a[1] + frac * (b[1] - a[1])
            bearing = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 360
            return lat, lon, bearing
        accum += seg_len
    last = waypoints[-1]
    return last[0], last[1], 0.0


@router.get("/api/buses/live")
def get_live_buses() -> dict:
    """Simulated real-time bus positions along actual Trento routes."""
    now = _time.time()
    features: list[dict] = []
    for line, waypoints in _ROUTES.items():
        for i in range(_BUSES_PER_ROUTE):
            offset = i * (_ROUTE_PERIOD / _BUSES_PER_ROUTE)
            t = ((now + offset) % _ROUTE_PERIOD) / _ROUTE_PERIOD
            lat, lon, bearing = _interpolate_route(waypoints, t)
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": f"bus-{line}-{i}",
                    "route": line,
                    "bearing": round(bearing),
                    "speed": 28 + (hash(f"{line}{i}") % 7) * 3,
                },
            })
    return {"type": "FeatureCollection", "features": features}
