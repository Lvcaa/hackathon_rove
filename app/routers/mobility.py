"""
Mobility data router — serves GeoJSON FeatureCollections from CSV datasets.

All heavy work (CSV parsing, coordinate conversion) happens at module import
time so the data is cached in memory and endpoints return instantly.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd
from fastapi import APIRouter
from pyproj import Transformer
from shapely import wkt as shapely_wkt

from ..tt_realtime import get_live_buses as _tt_live_buses
from ..tt_realtime import get_trip_route as _tt_trip_route
from ..tt_realtime import start as _tt_start

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


def _load_parking_lots() -> dict:
    """Named public parking lots (Polygon features) — already WGS84 GeoJSON."""
    import json

    path = DATASET_DIR / "parking_lots.geojson"
    if not path.exists():
        return _feature_collection([])
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


# Module-level caches — populated once on first import
_STATIONS: dict = _load_stations()
_TAXI: dict = _load_taxi()
_CARSHARING: dict = _load_carsharing()
_PARKING: dict = _load_parking()
_PARKING_LOTS: dict = _load_parking_lots()

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


@router.get("/api/parkinglots")
def get_parking_lots() -> dict:
    """GeoJSON FeatureCollection of named public parking lots (Polygon features)."""
    return _PARKING_LOTS


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
# Live buses — real-time positions from the Trentino Trasporti network
# ---------------------------------------------------------------------------

_tt_start()


@router.get("/api/buses/live")
def get_live_buses() -> dict:
    """
    Real-time bus positions for the whole Trentino Trasporti network (urban
    and extraurban). Positions come from the official `gtlservice` API and are
    interpolated along each trip's stop sequence — see `app/tt_realtime.py`.
    """
    return _tt_live_buses()


@router.get("/api/buses/{trip_id}/route")
def get_bus_route(trip_id: str) -> dict:
    """GeoJSON LineString of a single trip's full route, for the map preview."""
    return _tt_trip_route(trip_id)
