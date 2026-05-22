"""
Train router — three railways around Trento/Rovereto.

  * ``brennero`` — the Verona–Bolzano main line. Real schedules, platforms,
    delays and live train positions come from RFI's ViaggiaTreno service (the
    data behind viaggiatreno.it). Every operator on the line is covered:
    Regionale, Regionale Veloce, Intercity, Frecciarossa and the ÖBB/DB
    EuroCity. Italo runs no ViaggiaTreno-visible service here, so its trains
    are generated from a synthetic timetable.
  * ``ftm`` — the Trentino Trasporti narrow-gauge Trento–Malè–Mezzana line.
  * ``valsugana`` — the Trento–Bassano del Grappa line.

Both Trentino Trasporti lines get their stations, schedules and live trains
from the Trentino Trasporti ``gtlservice`` API, the same feed the live-bus
tracker uses.

Track geometry is the real OSM alignment (route relations in _RAIL_RELATIONS),
downloaded once and cached on disk. Every train marker is snapped onto that
polyline, so trains visibly follow the rails. A train with a fresh GPS fix is
shown live; otherwise its position is reconstructed from the scheduled stop
times — the same heuristic the synthetic fallback services always use.
"""

from __future__ import annotations

import bisect
import json
import math
import re
import threading
import time as _time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests
from fastapi import APIRouter

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

RAIL_DIR = Path(__file__).parent.parent / "dataset" / "rail"
ROME = ZoneInfo("Europe/Rome")

_VT_BASE = "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno"
_OVERPASS = "https://overpass-api.de/api/interpreter"
_HEADERS = {"User-Agent": "CommuteSync Hackathon/1.0"}

# OSM route relations carrying the real track alignment of each line.
_RAIL_RELATIONS = {"brennero": 1773670, "ftm": 1772516, "valsugana": 1772519}

# Trentino Trasporti service API. The FTM (Trento–Malè) and Valsugana
# (Trento–Bassano del Grappa) railways are served by the gtlservice feed — the
# same one the live-bus tracker uses. Each line lists its service route ids.
_TT_BASE = "https://app-tpl.tndigit.it/gtlservice"
_TT_AUTH = ("mittmobile", "ecGsp.RHB3")  # public credentials of the TT app
_TT_HEADERS = {"X-Requested-With": "it.tndigit.mit", "User-Agent": "CommuteSync/1.0"}
_TT_LINES: dict[str, dict] = {
    "ftm":       {"route_ids": [352], "brand": "trentino", "prefix": "FTM"},
    "valsugana": {"route_ids": [691, 693, 695, 696], "brand": "valsugana", "prefix": "VAL"},
}
# Service route id → public line label shown on trains and boards.
_ROUTE_LABEL = {352: "R35", 691: "R25", 695: "R25", 693: "R26", 696: "R26"}

_POLL_SEC = 40            # how often the background thread re-polls ViaggiaTreno
_LIVE_FIX_MAX_SEC = 1800  # a GPS fix older than this no longer counts as "live"
_TRACK_WORKERS = 16       # parallel andamentoTreno requests
_MAX_TRACKED = 70         # cap on ViaggiaTreno trains tracked per cycle

# Brennero corridor, south → north. ViaggiaTreno station codes were resolved
# via its cercaStazione endpoint; coordinates are snapped onto the rail line.
_BRENNERO_STATIONS = [
    ("S02430", "Verona Porta Nuova", "", 45.4289, 10.9820),
    ("S02055", "Domegliara-Sant'Ambrogio", "", 45.5494, 10.8389),
    ("S02052", "Peri", "", 45.6594, 10.9242),
    ("S02049", "Ala", "", 45.7556, 11.0044),
    ("S02044", "Rovereto", "", 45.8889, 11.0272),
    ("S02041", "Calliano", "", 45.9494, 11.0922),
    ("S02038", "Trento", "", 46.0717, 11.1194),
    ("S02035", "Mezzocorona", "", 46.2092, 11.1219),
    ("S02034", "Salorno", "Salurn", 46.2381, 11.2106),
    ("S02032", "Egna-Termeno", "Neumarkt-Tramin", 46.3194, 11.2719),
    ("S02031", "Ora", "Auer", 46.3475, 11.3019),
    ("S02030", "Bronzolo", "Branzoll", 46.4036, 11.3208),
    ("S02026", "Bolzano", "Bozen", 46.4964, 11.3567),
]

# Trentino Trasporti rail lines — fallback station lists, used only if the
# live gtlservice feed is unreachable at startup. The real, complete sets are
# loaded from the service.
_FTM_STATIONS = [
    ("FTM-TN", "Trento FS", "", 46.0717, 11.1194),
    ("FTM-LV", "Lavis", "", 46.1394, 11.1097),
    ("FTM-MZ", "Mezzolombardo", "", 46.2122, 11.0939),
    ("FTM-MC", "Mezzocorona FTM", "", 46.2147, 11.1219),
    ("FTM-CL", "Cles", "", 46.3661, 11.0339),
    ("FTM-ML", "Malè", "", 46.3536, 10.9136),
    ("FTM-MN", "Mezzana", "", 46.3181, 10.8047),
]
_VALSUGANA_STATIONS = [
    ("VAL-TN", "Trento", "", 46.0717, 11.1194),
    ("VAL-PE", "Pergine Valsugana", "", 46.0636, 11.2378),
    ("VAL-LV", "Levico Terme", "", 46.0114, 11.2986),
    ("VAL-CD", "Caldonazzo", "", 45.9939, 11.2706),
    ("VAL-BV", "Borgo Valsugana Est", "", 46.0533, 11.4561),
    ("VAL-ST", "Strigno", "", 46.0556, 11.5097),
    ("VAL-GR", "Grigno", "", 46.0119, 11.6386),
    ("VAL-PR", "Primolano", "", 45.9544, 11.6900),
    ("VAL-BS", "Bassano del Grappa", "", 45.7666, 11.7414),
]

# Train brands — colour, typical composition and whether it is a fast service.
# ``length_m`` is derived as cars × car length and feeds the map icon scale.
BRANDS: dict[str, dict] = {
    "frecciarossa": {"label": "Frecciarossa", "color": "#c4122e", "cars": 8, "car_m": 25, "fast": True},
    "italo":        {"label": "Italo",        "color": "#9d2235", "cars": 7, "car_m": 27, "fast": True},
    "eurocity":     {"label": "EuroCity ÖBB/DB", "color": "#2a4d8f", "cars": 7, "car_m": 26, "fast": True},
    "intercity":    {"label": "Intercity",    "color": "#3f7c8c", "cars": 9, "car_m": 26, "fast": False},
    "regionale_v":  {"label": "Regionale Veloce", "color": "#e0762a", "cars": 6, "car_m": 25, "fast": False},
    "regionale":    {"label": "Regionale",    "color": "#2f9e44", "cars": 4, "car_m": 24, "fast": False},
    "trentino":     {"label": "Trentino Trasporti", "color": "#d11f2d", "cars": 3, "car_m": 17, "fast": False},
    "valsugana":    {"label": "Valsugana",    "color": "#1f9e8f", "cars": 2, "car_m": 24, "fast": False},
}


def _brand_length(brand: str) -> int:
    b = BRANDS[brand]
    return b["cars"] * b["car_m"]


def _classify(categoria: str, cat_desc: str) -> str:
    """Map a ViaggiaTreno train category to one of the BRANDS keys."""
    c = (categoria or "").strip().upper()
    d = (cat_desc or "").strip().upper()
    if "FR" in d or c in ("FR", "FA", "FB"):
        return "frecciarossa"
    if "IT" in d or "AV" in d:
        return "italo"
    if c in ("EC", "ECN", "EN"):
        return "eurocity"
    if c in ("IC", "ICN", "EXP"):
        return "intercity"
    if c == "RV":
        return "regionale_v"
    return "regionale"


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlon = math.radians(b[1] - a[1])
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


# ---------------------------------------------------------------------------
# Rail line — the real OSM track polyline with cumulative distances
# ---------------------------------------------------------------------------

class RailLine:
    """An ordered track polyline with cumulative km, used to place trains."""

    def __init__(self, key: str, points: list[tuple[float, float]]):
        self.key = key
        self.points = points
        self.cum = [0.0]
        for i in range(1, len(points)):
            self.cum.append(self.cum[-1] + _haversine_km(points[i - 1], points[i]))
        self.length = self.cum[-1] if self.cum else 0.0

    def point_at(self, dist_km: float) -> tuple[float, float, float]:
        """(lat, lon, bearing) at a cumulative distance along the track."""
        if not self.points:
            return 0.0, 0.0, 0.0
        if dist_km <= 0:
            i = 0
        elif dist_km >= self.length:
            i = len(self.points) - 2
        else:
            i = bisect.bisect_right(self.cum, dist_km) - 1
        i = max(0, min(i, len(self.points) - 2))
        a, b = self.points[i], self.points[i + 1]
        span = self.cum[i + 1] - self.cum[i]
        f = (dist_km - self.cum[i]) / span if span > 0 else 0.0
        lat = a[0] + f * (b[0] - a[0])
        lon = a[1] + f * (b[1] - a[1])
        return lat, lon, _bearing(a, b)

    def project(self, lat: float, lon: float) -> float:
        """Cumulative distance of the polyline vertex nearest to (lat, lon)."""
        best_i, best_d = 0, float("inf")
        for i, p in enumerate(self.points):
            d = (p[0] - lat) ** 2 + (p[1] - lon) ** 2
            if d < best_d:
                best_d, best_i = d, i
        return self.cum[best_i]


def _stitch(ways: list[list[dict]]) -> list[tuple[float, float]]:
    """Join OSM relation member ways into one continuous polyline.

    Members come in route order; each way is flipped if its far end, rather
    than its near end, sits closer to the chain tail.
    """
    if not ways:
        return []
    chain = [(g["lat"], g["lon"]) for g in ways[0]]
    for way in ways[1:]:
        seg = [(g["lat"], g["lon"]) for g in way]
        if len(seg) < 2:
            continue
        tail = chain[-1]
        d_head = (tail[0] - seg[0][0]) ** 2 + (tail[1] - seg[0][1]) ** 2
        d_foot = (tail[0] - seg[-1][0]) ** 2 + (tail[1] - seg[-1][1]) ** 2
        if d_foot < d_head:
            seg.reverse()
        chain.extend(seg)
    return chain


def _load_rail(key: str, rel_id: int) -> list[tuple[float, float]]:
    """Stitched track polyline for a line, cached on disk after first fetch."""
    cache = RAIL_DIR / f"{key}.json"
    if cache.exists():
        return [tuple(p) for p in json.loads(cache.read_text())]
    query = f"[out:json][timeout:120];rel({rel_id});out geom;"
    resp = requests.get(
        _OVERPASS, params={"data": query}, headers=_HEADERS, timeout=140
    )
    resp.raise_for_status()
    members = resp.json()["elements"][0]["members"]
    ways = [m["geometry"] for m in members if m["type"] == "way" and "geometry" in m]
    points = _stitch(ways)
    RAIL_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(points))
    return points


# ---------------------------------------------------------------------------
# Trentino Trasporti service client (FTM + Valsugana live data)
# ---------------------------------------------------------------------------

def _tt_get(path: str, params: dict | None = None):
    resp = requests.get(
        f"{_TT_BASE}{path}", params=params, auth=_TT_AUTH,
        headers=_TT_HEADERS, timeout=25,
    )
    resp.raise_for_status()
    return resp.json()


def _gtfs_sec(value: str) -> int:
    """GTFS clock time 'HH:MM[:SS]' → seconds since midnight (may exceed 24h)."""
    parts = value.split(":")
    return (int(parts[0]) * 3600 + int(parts[1]) * 60
            + (int(parts[2]) if len(parts) > 2 and parts[2] else 0))


def _clean_tt_label(raw: str | None) -> str:
    """Trim Trentino Trasporti's station tags ('Ftm', 'Staz. Fs', …).

    Used for both train headsigns and station names.
    """
    text = re.sub(r"(?i)\b(ftm|ferrovia|stazione|staz\.?|fs)\b", "", raw or "")
    text = re.sub(r"\s{2,}", " ", text).strip(" .,-·")
    return text.title() or "Trentino Trasporti"


_tt_stops_cache: dict[int, dict] = {}


def _tt_stop_catalogue() -> dict[int, dict]:
    """The Trentino Trasporti stop catalogue (stopId → stop), fetched once."""
    if not _tt_stops_cache:
        for s in _tt_get("/stops", {"size": 20000}) or []:
            sid = s.get("stopId")
            if sid is not None:
                _tt_stops_cache[sid] = s
    return _tt_stops_cache


def _load_tt_stations(line: RailLine, route_ids: list[int], prefix: str) -> list[tuple]:
    """Real stations of a Trentino Trasporti rail line, ordered along the track.

    Station ids are gathered from each route's trip stop sequences; coordinates
    and names come from the service's stop catalogue.
    """
    stop_ids: set = set()
    for rid in route_ids:
        try:
            trips = _tt_get("/trips_new", {"routeId": rid, "type": "E", "limit": 150})
        except Exception:
            continue
        for t in trips or []:
            for st in t.get("stopTimes") or []:
                sid = st.get("stopId")
                if sid is not None:
                    stop_ids.add(sid)

    catalogue = _tt_stop_catalogue()
    stations: list[tuple] = []
    for sid in stop_ids:
        s = catalogue.get(sid)
        if not s:
            continue
        try:
            lat, lon = float(s["stopLat"]), float(s["stopLon"])
        except (KeyError, TypeError, ValueError):
            continue
        # Keep only stops that actually sit on this line's track — guards
        # against a stray off-line stop leaking in from a shared route id.
        if min(_haversine_km((lat, lon), p) for p in line.points) > 3.0:
            continue
        name = _clean_tt_label(s.get("stopName")) or "Fermata"
        stations.append((f"{prefix}-{sid}", name, "", lat, lon, sid))
    stations.sort(key=lambda st: line.project(st[3], st[4]))
    return stations


# ---------------------------------------------------------------------------
# Build lines and stations (once, at import time)
# ---------------------------------------------------------------------------

_LINES: dict[str, RailLine] = {}
_STATIONS: list[dict] = []      # ordered: every station of every line
_STATION_BY_CODE: dict[str, dict] = {}
_TT_STOP_RAILPOS: dict[int, float] = {}    # TT stopId -> rail position (km)
_TT_OK: dict[str, bool] = {}               # TT line key -> real data loaded

_FALLBACK_STATIONS = {
    "brennero": _BRENNERO_STATIONS,
    "ftm": _FTM_STATIONS,
    "valsugana": _VALSUGANA_STATIONS,
}


def _build_static() -> None:
    for key, rel_id in _RAIL_RELATIONS.items():
        seed = _FALLBACK_STATIONS[key]
        try:
            line = RailLine(key, _load_rail(key, rel_id))
        except Exception:
            # Overpass unreachable — fall back to a polyline through the
            # seed stations so trains still have rails to ride.
            line = RailLine(key, [(e[3], e[4]) for e in seed])
        _LINES[key] = line

        entries = list(seed)
        cfg = _TT_LINES.get(key)
        if cfg is not None:
            try:
                loaded = _load_tt_stations(line, cfg["route_ids"], cfg["prefix"])
                if len(loaded) >= 3:
                    entries = loaded
                    _TT_OK[key] = True
            except Exception:
                pass  # keep the hardcoded fallback list

        entries.sort(key=lambda e: line.project(e[3], e[4]))
        for order, entry in enumerate(entries):
            code, name, name_de, lat, lon = entry[:5]
            stop_id = entry[5] if len(entry) > 5 else None
            station = {
                "code": code, "name": name, "name_de": name_de,
                "lat": lat, "lon": lon, "line": key, "order": order,
                "railpos": line.project(lat, lon), "stop_id": stop_id,
            }
            _STATIONS.append(station)
            _STATION_BY_CODE[code] = station
            if stop_id is not None:
                _TT_STOP_RAILPOS[stop_id] = station["railpos"]


_build_static()
_BRENNERO_CODES = {s["code"] for s in _STATIONS if s["line"] == "brennero"}

# ---------------------------------------------------------------------------
# ViaggiaTreno client
# ---------------------------------------------------------------------------

_session = requests.Session()
_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _vt_date(dt: datetime) -> str:
    """ViaggiaTreno's expected date string, e.g. 'Thu May 21 2026 13:57:00'."""
    return (f"{_DOW[dt.weekday()]} {_MON[dt.month - 1]} {dt.day:02d} "
            f"{dt.year} {dt:%H:%M:%S}")


def _vt_get(path: str):
    resp = _session.get(f"{_VT_BASE}/{path}", headers=_HEADERS, timeout=15)
    resp.raise_for_status()
    text = resp.text.strip()
    if not text:
        return None
    return resp.json()


def _vt_departures(code: str, dt: datetime) -> list[dict]:
    try:
        data = _vt_get(f"partenze/{code}/{quote(_vt_date(dt))}")
        return data if isinstance(data, list) else []
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Live train state (filled by the background poller)
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_vt_trips: list[dict] = []                 # tracked ViaggiaTreno trips (Brennero)
_tt_trips: dict[str, list[dict]] = {}      # TT line key -> positionable trips
_tt_raw: dict[str, list[dict]] = {}        # TT line key -> raw trips (for boards)
_board_cache: dict[str, tuple[float, list[dict]]] = {}  # code -> (epoch, raw)
_VT_OK = False
_started = False


def _build_trip(
    cod_origine: str, numero: int, data_partenza: int,
    categoria: str = "", cat_desc: str = "",
) -> dict | None:
    """Resolve one ViaggiaTreno train into a corridor-clipped trip.

    The returned trip carries, for every stop inside the Brennero corridor,
    its cumulative rail position and the actual time the train is expected
    there (scheduled time shifted by the live delay). ``categoria`` /
    ``cat_desc`` come from the departure board — the andamentoTreno detail
    often omits them, so the board's values are used to brand the train.
    """
    try:
        detail = _vt_get(f"andamentoTreno/{cod_origine}/{numero}/{data_partenza}")
    except Exception:
        return None
    if not isinstance(detail, dict):
        return None

    fermate = detail.get("fermate") or []
    delay_min = detail.get("ritardo") or 0
    points: list[tuple[float, float]] = []  # (railpos_km, actual_epoch_ms)
    for f in fermate:
        station = _STATION_BY_CODE.get(f.get("id"))
        if station is None or station["line"] != "brennero":
            continue
        scheduled = f.get("programmata")
        if scheduled is None:
            continue
        actual = f.get("effettiva") or (scheduled + delay_min * 60_000)
        points.append((station["railpos"], float(actual)))

    if len(points) < 2:
        return None  # train never travels two corridor stations — not on the line

    # ViaggiaTreno reports fermate in route order; guarantee monotone time.
    points.sort(key=lambda p: p[1])

    fix = detail.get("oraUltimoRilevamento")
    live = bool(fix) and (_time.time() * 1000 - fix) < _LIVE_FIX_MAX_SEC * 1000
    brand = _classify(
        categoria or detail.get("categoria", ""),
        cat_desc or detail.get("categoriaDescrizione", ""),
    )

    return {
        "id": f"vt-{numero}",
        "line": "brennero",
        "brand": brand,
        "number": (detail.get("compNumeroTreno") or str(numero)).strip(),
        "headsign": (detail.get("destinazione") or "").strip().title(),
        "delay": int(delay_min),
        "live": live,
        "points": points,
    }


def _poll() -> None:
    """One ViaggiaTreno refresh cycle — discover and track corridor trains."""
    global _vt_trips, _VT_OK
    now = datetime.now(ROME)

    # Discovery: a handful of stations whose departure boards, together,
    # surface every train running the corridor.
    discovery = ["S02430", "S02044", "S02038", "S02035", "S02026"]
    seen: dict[tuple, tuple] = {}
    for code in discovery:
        deps = _vt_departures(code, now)
        _board_cache[code] = (_time.time(), deps)
        for t in deps:
            num = t.get("numeroTreno")
            origin = t.get("codOrigine")
            dep = t.get("dataPartenzaTreno")
            if num and origin and dep:
                seen[(origin, num)] = (
                    origin, num, dep,
                    t.get("categoria", ""), t.get("categoriaDescrizione", ""),
                )

    keys = list(seen.values())[:_MAX_TRACKED]
    if not keys:
        return

    trips: list[dict] = []
    with ThreadPoolExecutor(max_workers=_TRACK_WORKERS) as ex:
        for trip in ex.map(lambda k: _build_trip(*k), keys):
            if trip:
                trips.append(trip)

    with _lock:
        _vt_trips = trips
    _VT_OK = True


def _build_tt_trip(
    t: dict, midnight_ms: float, line_key: str, brand: str,
) -> dict | None:
    """Turn one Trentino Trasporti rail trip into a positionable trip.

    Each stop is mapped onto the line's rail polyline; scheduled stop times are
    shifted by the live delay so the train rides the rails on time.
    """
    delay_min = t.get("delay") or 0
    points: list[tuple[float, float]] = []
    for st in t.get("stopTimes") or []:
        railpos = _TT_STOP_RAILPOS.get(st.get("stopId"))
        if railpos is None:
            continue
        raw_time = st.get("departureTime") or st.get("arrivalTime")
        if not raw_time:
            continue
        try:
            sec = _gtfs_sec(raw_time)
        except (ValueError, AttributeError, IndexError):
            continue
        actual = midnight_ms + (sec + delay_min * 60) * 1000
        points.append((railpos, float(actual)))

    if len(points) < 2:
        return None
    points.sort(key=lambda p: p[1])

    return {
        "id": f"{line_key}-{t.get('tripId')}",
        "line": line_key,
        "brand": brand,
        "number": _ROUTE_LABEL.get(t.get("routeId"), "R"),
        "headsign": _clean_tt_label(t.get("tripHeadsign")),
        "delay": int(delay_min),
        "live": bool(t.get("matricolaBus") and t.get("lastEventRecivedAt")),
        "points": points,
    }


def _poll_tt(line_key: str) -> None:
    """One refresh cycle for a Trentino Trasporti rail line — live trips."""
    cfg = _TT_LINES[line_key]
    seen: dict[str, dict] = {}
    for route_id in cfg["route_ids"]:
        try:
            raw = _tt_get(
                "/trips_new", {"routeId": route_id, "type": "E", "limit": 200})
        except Exception:
            continue
        for t in raw or []:
            tid = t.get("tripId")
            if tid and tid not in seen:
                seen[tid] = t
    if not seen:
        return

    raw_trips = list(seen.values())
    now = datetime.now(ROME)
    midnight_ms = now.replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000

    trips: list[dict] = []
    for t in raw_trips:
        trip = _build_tt_trip(t, midnight_ms, line_key, cfg["brand"])
        if trip:
            trips.append(trip)

    with _lock:
        _tt_trips[line_key] = trips
        _tt_raw[line_key] = raw_trips
    _TT_OK[line_key] = True


def _worker() -> None:
    while True:
        try:
            _poll()
        except Exception:
            pass  # keep the last good cache, retry next cycle
        for line_key in _TT_LINES:
            try:
                _poll_tt(line_key)
            except Exception:
                pass
        _time.sleep(_POLL_SEC)


def start() -> None:
    """Start the background ViaggiaTreno poller once."""
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_worker, daemon=True, name="trains-poll").start()


# ---------------------------------------------------------------------------
# Synthetic timetable — Brennero line only (FTM/Valsugana use live TT data)
# ---------------------------------------------------------------------------

# brand, line, headway (min), traversal (min), departures per direction.
# Italo runs no ViaggiaTreno-visible service on the Brennero line, so it is
# always synthetic.
_SYNTH_ALWAYS = [
    ("italo", "brennero", 130, 96, 11),
]
# Added only when ViaggiaTreno is unreachable, so the Brennero line is never
# empty even with no upstream data.
_SYNTH_BRENNERO_FALLBACK = [
    ("regionale", "brennero", 32, 138, 44),
    ("frecciarossa", "brennero", 70, 86, 22),
    ("regionale_v", "brennero", 95, 112, 16),
    ("eurocity", "brennero", 180, 100, 8),
]


def _synthetic_trips(now_ms: float) -> list[dict]:
    """Trips from the synthetic timetable that are running right now."""
    now = datetime.now(ROME)
    midnight_ms = now.replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000

    specs = list(_SYNTH_ALWAYS)
    if not _VT_OK:
        specs += _SYNTH_BRENNERO_FALLBACK

    trips: list[dict] = []
    for brand, line_key, headway, traversal, count in specs:
        line = _LINES.get(line_key)
        if line is None:
            continue
        traversal_ms = traversal * 60_000
        for direction in (1, -1):
            head_label = "Bolzano" if direction == 1 else "Verona Porta Nuova"
            for k in range(count):
                # First service at 05:00, then one every `headway` minutes.
                depart_ms = midnight_ms + (300 + k * headway) * 60_000
                if not (depart_ms <= now_ms <= depart_ms + traversal_ms):
                    continue
                if direction == 1:
                    pts = [(0.0, depart_ms), (line.length, depart_ms + traversal_ms)]
                else:
                    pts = [(line.length, depart_ms), (0.0, depart_ms + traversal_ms)]
                trips.append({
                    "id": f"syn-{brand}-{line_key}-{direction}-{k}",
                    "line": line_key,
                    "brand": brand,
                    "number": f"{_synth_number(brand, k)}",
                    "headsign": head_label,
                    "delay": 0,
                    "live": False,
                    "points": pts,
                })
    return trips


def _synth_number(brand: str, k: int) -> str:
    prefix = {"italo": "ITA", "regionale": "RE",
              "frecciarossa": "FR", "regionale_v": "RV", "eurocity": "EC"}
    base = {"italo": 8900, "regionale": 5600,
            "frecciarossa": 9700, "regionale_v": 2200, "eurocity": 80}
    return f"{prefix.get(brand, 'T')} {base.get(brand, 100) + k}"


# ---------------------------------------------------------------------------
# Position reconstruction
# ---------------------------------------------------------------------------

def _train_position(trip: dict, now_ms: float):
    """Place a trip on its rail line at the current wall-clock time.

    Returns (lat, lon, bearing, speed_kmh, rail_dist_km, forward) or None when
    the train is not inside the modelled corridor right now. ``rail_dist_km``
    is the head of the train along the track and ``forward`` is the travel
    direction — both are needed to lay the carriages out behind the head.
    """
    pts = trip["points"]
    times = [p[1] for p in pts]
    dists = [p[0] for p in pts]
    if now_ms < times[0] or now_ms > times[-1]:
        return None

    seg = bisect.bisect_right(times, now_ms) - 1
    seg = max(0, min(seg, len(pts) - 2))
    t0, t1 = times[seg], times[seg + 1]
    d0, d1 = dists[seg], dists[seg + 1]
    f = (now_ms - t0) / (t1 - t0) if t1 > t0 else 0.0
    dist = d0 + f * (d1 - d0)

    line = _LINES[trip["line"]]
    lat, lon, bearing = line.point_at(dist)
    forward = d1 >= d0
    if not forward:                   # travelling toward decreasing rail km
        bearing = (bearing + 180) % 360

    hours = (t1 - t0) / 3_600_000
    speed = abs(d1 - d0) / hours if hours > 0 else 0.0
    return lat, lon, bearing, min(round(speed), 300), dist, forward


def _carriages(
    line: RailLine, head_dist: float, forward: bool, cars: int, length_m: int,
) -> list[dict]:
    """Lay each carriage out along the track, trailing behind the train head.

    The train occupies ``length_m`` of track; carriage centres are spaced
    evenly back from the head and each is snapped onto the rail polyline, so
    the whole train bends with the rails through curves.
    """
    cars = max(cars, 1)
    car_km = (length_m / 1000.0) / cars
    out: list[dict] = []
    for k in range(cars):
        offset = (k + 0.5) * car_km
        d = head_dist - offset if forward else head_dist + offset
        d = max(0.0, min(line.length, d))
        lat, lon, brg = line.point_at(d)
        if not forward:
            brg = (brg + 180) % 360
        out.append({"lat": round(lat, 6), "lon": round(lon, 6), "bearing": round(brg)})
    return out


def _all_trips() -> list[dict]:
    with _lock:
        trips = list(_vt_trips)
        for line_trips in _tt_trips.values():
            trips += line_trips
    now_ms = _time.time() * 1000
    return trips + _synthetic_trips(now_ms)


# ---------------------------------------------------------------------------
# Trip planning helper — a train leg between two points (used by the AI planner)
# ---------------------------------------------------------------------------

# Average door-to-door speed along each line (km/h), incl. station dwell.
_TRAIN_SPEED_KMH = {"brennero": 78.0, "ftm": 42.0}
_TRAIN_WAIT_MIN = 7.0      # typical wait on the platform for the next service
_TRAIN_BASE_FARE = 1.30    # € fixed, plus a per-km component
_TRAIN_PER_KM = 0.165      # € per rail km (≈ Trentino regional tariff)


# Beyond this access distance a station no longer realistically serves an
# endpoint — the train would not be a sensible option for that leg.
_TRAIN_ACCESS_MAX_KM = 8.0


def _nearest_on_line(lat: float, lon: float, line_key: str) -> tuple[dict | None, float]:
    """Closest station on one line to a point, with the distance in km."""
    best, best_km = None, float("inf")
    for s in _STATIONS:
        if s["line"] != line_key:
            continue
        km = _haversine_km((lat, lon), (s["lat"], s["lon"]))
        if km < best_km:
            best, best_km = s, km
    return best, best_km


def _rail_subpath(line: RailLine, d0: float, d1: float) -> list[list[float]]:
    """[lng, lat] vertices of the track between two rail positions (km).

    The path runs from d0 to d1, so reversing the arguments reverses the
    drawn polyline — letting the caller orient it origin → destination.
    """
    lo, hi = min(d0, d1), max(d0, d1)
    lat0, lon0, _ = line.point_at(lo)
    pts: list[tuple[float, float]] = [(lat0, lon0)]
    for i, c in enumerate(line.cum):
        if lo < c < hi:
            pts.append(line.points[i])
    lat1, lon1, _ = line.point_at(hi)
    pts.append((lat1, lon1))
    if d0 > d1:
        pts.reverse()
    return [[lon, lat] for lat, lon in pts]


def plan_train_leg(o_lat: float, o_lng: float,
                   d_lat: float, d_lng: float) -> dict | None:
    """Best single-line train connection between the origin and destination.

    Each modelled line is considered independently: the station on that line
    nearest the origin and the one nearest the destination. The line that
    minimises the total access walking wins. Returns None when no line serves
    both ends — no station close enough, or the same station serves both.
    """
    best: tuple[float, str, dict, dict] | None = None
    for line_key in _LINES:
        o_st, o_km = _nearest_on_line(o_lat, o_lng, line_key)
        d_st, d_km = _nearest_on_line(d_lat, d_lng, line_key)
        if o_st is None or d_st is None or o_st["code"] == d_st["code"]:
            continue
        if o_km > _TRAIN_ACCESS_MAX_KM or d_km > _TRAIN_ACCESS_MAX_KM:
            continue
        if abs(o_st["railpos"] - d_st["railpos"]) < 0.3:
            continue
        access = o_km + d_km
        if best is None or access < best[0]:
            best = (access, line_key, o_st, d_st)

    if best is None:
        return None

    _, line_key, o_st, d_st = best
    line = _LINES[line_key]

    a, b = o_st["railpos"], d_st["railpos"]
    rail_km = abs(b - a)
    speed = _TRAIN_SPEED_KMH.get(line_key, 60.0)
    duration_min = rail_km / speed * 60.0 + _TRAIN_WAIT_MIN
    fare = _TRAIN_BASE_FARE + rail_km * _TRAIN_PER_KM

    def _pt(s: dict) -> dict:
        return {
            "name": s["name"], "lat": s["lat"], "lng": s["lon"],
            "code": s["code"], "line": s["line"],
        }

    return {
        "origin_station": _pt(o_st),
        "dest_station":    _pt(d_st),
        "line":            o_st["line"],
        "polyline":        _rail_subpath(line, a, b),
        "distance_m":      round(rail_km * 1000),
        "duration_min":    round(duration_min, 1),
        "fare_eur":        round(fare, 2),
    }


def get_upcoming_train_info(o_code: str, d_code: str) -> str | None:
    """Find the next upcoming train departing o_code towards d_code, and return its identifier."""
    o_st = _STATION_BY_CODE.get(o_code)
    d_st = _STATION_BY_CODE.get(d_code)
    if not o_st or not d_st or o_st["line"] != d_st["line"]:
        return None

    now_ms = _time.time() * 1000
    upcoming = []

    o_railpos = o_st["railpos"]
    d_railpos = d_st["railpos"]
    increasing = o_railpos < d_railpos

    for trip in _all_trips():
        if trip["line"] != o_st["line"]:
            continue

        pts = trip["points"]
        if len(pts) < 2:
            continue

        # Check direction of travel
        start_pos = pts[0][0]
        end_pos = pts[-1][0]
        trip_increasing = start_pos < end_pos
        if trip_increasing != increasing:
            continue

        # Find estimated time when the train is at o_railpos
        dep_time_ms = None
        for i in range(len(pts) - 1):
            p0, t0 = pts[i]
            p1, t1 = pts[i + 1]
            if min(p0, p1) <= o_railpos <= max(p0, p1):
                span = p1 - p0
                if abs(span) > 0.0001:
                    f = (o_railpos - p0) / span
                    dep_time_ms = t0 + f * (t1 - t0)
                else:
                    dep_time_ms = t0
                break

        if dep_time_ms is not None and dep_time_ms >= now_ms - 120_000:
            upcoming.append((dep_time_ms, trip))

    if upcoming:
        upcoming.sort(key=lambda x: x[0])
        next_trip = upcoming[0][1]

        brand = next_trip.get("brand")
        num = next_trip.get("number", "")

        brand_meta = BRANDS.get(brand)
        brand_label = brand_meta["label"] if brand_meta else ""

        if num:
            if brand == "regionale_v" and not num.startswith("RV"):
                return f"RV {num}"
            elif brand == "regionale" and not num.startswith("RE") and not num.startswith("R"):
                return f"Regionale {num}"
            elif brand == "frecciarossa" and not num.startswith("FR"):
                return f"Frecciarossa {num}"
            elif brand == "italo" and not num.startswith("ITA") and not num.startswith("Italo"):
                return f"Italo {num}"
            elif brand == "eurocity" and not num.startswith("EC"):
                return f"EuroCity {num}"
            elif brand == "trentino":
                return f"Treno FTM {num}"
            elif brand == "valsugana":
                return f"Treno Valsugana {num}"
            return f"{brand_label} {num}" if brand_label and brand_label not in num else num

        return brand_label or "Treno"

    # Fallback to line names
    if o_st["line"] == "ftm":
        return "Treno FTM (Trento-Malè)"
    elif o_st["line"] == "valsugana":
        return "Treno Valsugana"
    else:
        return "Treno Brennero"


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter()


@router.get("/api/rail")
def get_rail() -> dict:
    """GeoJSON LineStrings of each modelled railway's real OSM alignment."""
    features = []
    for key, line in _LINES.items():
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[lon, lat] for lat, lon in line.points],
            },
            "properties": {"line": key, "length_km": round(line.length, 1)},
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/api/trainstations")
def get_train_stations() -> dict:
    """GeoJSON Point features for every station on the modelled lines."""
    features = []
    for s in _STATIONS:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
            "properties": {
                "code": s["code"], "name": s["name"], "name_de": s["name_de"],
                "line": s["line"], "order": s["order"],
            },
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/api/trains/live")
def get_live_trains() -> dict:
    """
    GeoJSON Point features for every train currently inside a modelled
    corridor. ``live`` is true for a real ViaggiaTreno GPS fix and false for a
    position reconstructed from the timetable.
    """
    now_ms = _time.time() * 1000
    features: list[dict] = []
    for trip in _all_trips():
        pos = _train_position(trip, now_ms)
        if pos is None:
            continue
        lat, lon, bearing, speed, dist, forward = pos
        brand = trip["brand"]
        meta = BRANDS[brand]
        length_m = _brand_length(brand)
        carriages = _carriages(
            _LINES[trip["line"]], dist, forward, meta["cars"], length_m)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "id": trip["id"],
                "brand": brand,
                "brand_label": meta["label"],
                "color": meta["color"],
                "fast": meta["fast"],
                "cars": meta["cars"],
                "length_m": length_m,
                "number": trip["number"],
                "headsign": trip["headsign"],
                "line": trip["line"],
                "delay": trip["delay"],
                "live": trip["live"],
                "bearing": round(bearing),
                "speed": speed,
                "carriages": carriages,
            },
        })
    return {"type": "FeatureCollection", "features": features}


def _brennero_board(code: str, ref: datetime, limit: int) -> list[dict]:
    """Departure board for a Brennero station, from live ViaggiaTreno data."""
    cached = _board_cache.get(code)
    fresh = cached and (_time.time() - cached[0]) < 90 and \
        abs((ref - datetime.now(ROME)).total_seconds()) < 120
    raw = cached[1] if fresh else _vt_departures(code, ref)

    now_ms = _time.time() * 1000
    rows: list[dict] = []
    for t in raw:
        brand = _classify(t.get("categoria", ""), t.get("categoriaDescrizione", ""))
        platform = (t.get("binarioEffettivoPartenzaDescrizione")
                    or t.get("binarioProgrammatoPartenzaDescrizione") or "")
        dep_ms = t.get("orarioPartenza")
        in_min = round((dep_ms - now_ms) / 60_000) if dep_ms else None
        if in_min is not None and in_min < -2:
            continue  # already departed — drop from the "next trains" board
        rows.append({
            "number": (t.get("compNumeroTreno") or "").strip(),
            "brand": brand,
            "brand_label": BRANDS[brand]["label"],
            "color": BRANDS[brand]["color"],
            "destination": (t.get("destinazione") or "").strip().title(),
            "time": (t.get("compOrarioPartenza") or "").strip(),
            "delay": int(t.get("ritardo") or 0),
            "platform": str(platform).strip(),
            "departed": bool(t.get("nonPartito") is False and t.get("inStazione") is False),
            "in_min": in_min,
        })
    rows.sort(key=lambda r: r["in_min"] if r["in_min"] is not None else 1e9)
    return rows[:limit]


def _tt_board_live(station: dict, ref: datetime, limit: int) -> list[dict]:
    """Departure board for an FTM / Valsugana station, from live TT trips."""
    sid = station.get("stop_id")
    line_key = station["line"]
    brand = _TT_LINES[line_key]["brand"]
    ref_ms = ref.timestamp() * 1000
    midnight_ms = ref.replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000
    with _lock:
        raw = list(_tt_raw.get(line_key, []))

    rows: list[dict] = []
    for t in raw:
        delay = int(t.get("delay") or 0)
        for st in t.get("stopTimes") or []:
            if st.get("stopId") != sid:
                continue
            raw_time = st.get("departureTime") or st.get("arrivalTime")
            if not raw_time:
                break
            try:
                sec = _gtfs_sec(raw_time)
            except (ValueError, AttributeError, IndexError):
                break
            pass_ms = midnight_ms + (sec + delay * 60) * 1000
            in_min = round((pass_ms - ref_ms) / 60_000)
            if in_min < -2 or in_min > 360:
                break
            rows.append({
                "number": _ROUTE_LABEL.get(t.get("routeId"), "R"),
                "brand": brand,
                "brand_label": BRANDS[brand]["label"],
                "color": BRANDS[brand]["color"],
                "destination": _clean_tt_label(t.get("tripHeadsign")),
                "time": datetime.fromtimestamp(pass_ms / 1000, ROME).strftime("%H:%M"),
                "delay": delay,
                "platform": "1" if t.get("directionId") == 0 else "2",
                "departed": False,
                "in_min": in_min,
            })
            break
    rows.sort(key=lambda r: r["in_min"])
    return rows[:limit]


@router.get("/api/trainstations/{code}/board")
def get_station_board(code: str, time: str | None = None, limit: int = 12) -> dict:
    """Scheduled departures from a station, each with its platform/track."""
    station = _STATION_BY_CODE.get(code)
    limit = max(1, min(limit, 30))

    ref = datetime.now(ROME)
    if time:
        try:
            hh, mm = time.split(":")
            ref = ref.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        except (ValueError, AttributeError):
            time = None

    if station is None:
        departures: list[dict] = []
    elif station["line"] == "brennero":
        departures = _brennero_board(code, ref, limit)
    else:
        departures = _tt_board_live(station, ref, limit)

    return {
        "code": code,
        "name": station["name"] if station else "",
        "line": station["line"] if station else "",
        "time": time or ref.strftime("%H:%M"),
        "date": ref.date().isoformat(),
        "departures": departures,
    }


start()
