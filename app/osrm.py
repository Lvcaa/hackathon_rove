"""
OSRM foot-routing helper.

Fetches real, pavement-following geometry for walking legs from the public
FOSSGIS OSRM instance (the routing backend behind openstreetmap.org). Results
are cached in memory; any failure returns ``None`` so callers can fall back to
a straight line and the app keeps working offline.
"""

from __future__ import annotations

import requests

_FOOT_URL = (
    "https://routing.openstreetmap.de/routed-foot/route/v1/foot/"
    "{lng1},{lat1};{lng2},{lat2}"
)
_CAR_URL = (
    "https://routing.openstreetmap.de/routed-car/route/v1/driving/"
    "{lng1},{lat1};{lng2},{lat2}"
)
_PARAMS = {"overview": "full", "geometries": "geojson"}
_TIMEOUT = 3.5
_HEADERS = {"User-Agent": "CommuteSync Hackathon/1.0"}

# Geometry is static, so a successful lookup is cached for the process lifetime.
# Keyed by endpoint coordinates rounded to ~1 m. Failures are not cached.
_cache: dict[tuple[float, float, float, float], dict] = {}
_drive_cache: dict[tuple[float, float, float, float], dict] = {}


def _key(lat1: float, lng1: float, lat2: float, lng2: float) -> tuple[float, float, float, float]:
    return (round(lat1, 5), round(lng1, 5), round(lat2, 5), round(lng2, 5))


def _fetch(url_template: str, cache: dict, lat1: float, lng1: float, lat2: float, lng2: float) -> dict | None:
    key = _key(lat1, lng1, lat2, lng2)
    cached = cache.get(key)
    if cached is not None:
        return cached
    url = url_template.format(lng1=lng1, lat1=lat1, lng2=lng2, lat2=lat2)
    try:
        resp = requests.get(url, params=_PARAMS, headers=_HEADERS, timeout=_TIMEOUT)
        resp.raise_for_status()
        route = (resp.json().get("routes") or [None])[0]
        if not route:
            return None
        coords = route["geometry"]["coordinates"]
        if len(coords) < 2:
            return None
        result = {
            "polyline":     [[float(c[0]), float(c[1])] for c in coords],
            "distance_m":   float(route["distance"]),
            "duration_min": float(route["duration"]) / 60.0,
        }
        cache[key] = result
        return result
    except Exception:
        return None


def walk_route(lat1: float, lng1: float, lat2: float, lng2: float) -> dict | None:
    """Real foot route between two WGS84 points.

    Returns ``{"polyline": [[lng, lat], ...], "distance_m", "duration_min"}``
    or ``None`` when the routing service cannot be reached.
    """
    return _fetch(_FOOT_URL, _cache, lat1, lng1, lat2, lng2)


def drive_route(lat1: float, lng1: float, lat2: float, lng2: float) -> dict | None:
    """Real car route between two WGS84 points (same shape as walk_route)."""
    return _fetch(_CAR_URL, _drive_cache, lat1, lng1, lat2, lng2)
