"""
Address geocoding via Nominatim (OpenStreetMap).

Resolves an arbitrary address or place name to WGS84 coordinates, bounded to
the Trento–Rovereto region so the result can always be reached by the modelled
mobility network. Successful lookups are cached in memory for the process
lifetime; any failure returns ``None`` so callers can fall back gracefully.
"""

from __future__ import annotations

import requests

# Trento + Rovereto + the rail corridor between them, plus a margin north and
# south. Nominatim's viewbox is "lng1,lat1,lng2,lat2" (any two opposite corners).
_VIEWBOX = "10.75,45.65,11.45,46.35"
_LAT_MIN, _LAT_MAX = 45.65, 46.35
_LNG_MIN, _LNG_MAX = 10.75, 11.45

_URL = "https://nominatim.openstreetmap.org/search"
_TIMEOUT = 5.0
_HEADERS = {"User-Agent": "CommuteSync Hackathon/1.0 (mobility planner)"}

# query (lower-cased) → resolved place dict, or None for a confirmed miss.
_cache: dict[str, dict | None] = {}


def _short_name(r: dict) -> str:
    """A concise label from a Nominatim result — name + town when useful."""
    name = (r.get("name") or "").strip()
    addr = r.get("address") or {}
    town = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality")
    if name:
        if town and town.lower() not in name.lower():
            return f"{name}, {town}"
        return name
    # No short name — keep the first two comma-separated parts of display_name.
    display = (r.get("display_name") or "Destinazione").split(",")
    return ", ".join(p.strip() for p in display[:2] if p.strip())


def geocode(query: str) -> dict | None:
    """Resolve a free-text address/place to ``{lat, lng, name, category}``.

    Returns ``None`` when the place can't be found, falls outside the modelled
    region, or the geocoding service is unreachable.
    """
    q = (query or "").strip()
    if len(q) < 3:
        return None

    key = q.lower()
    if key in _cache:
        return _cache[key]

    try:
        resp = requests.get(
            _URL,
            params={
                "q": q,
                "format": "jsonv2",
                "limit": 1,
                "countrycodes": "it",
                "viewbox": _VIEWBOX,
                "bounded": 1,
                "addressdetails": 1,
            },
            headers=_HEADERS,
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json()
        if not results:
            _cache[key] = None
            return None

        r = results[0]
        lat, lng = float(r["lat"]), float(r["lon"])
        if not (_LAT_MIN <= lat <= _LAT_MAX and _LNG_MIN <= lng <= _LNG_MAX):
            _cache[key] = None
            return None

        place = {"lat": lat, "lng": lng, "name": _short_name(r), "category": "address"}
        _cache[key] = place
        return place
    except Exception:
        return None
