from math import radians, sin, cos, sqrt, atan2

from pyproj import Transformer
from shapely import wkt as shapely_wkt

_transformer = Transformer.from_crs("EPSG:32632", "EPSG:4326", always_xy=True)


def _to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    lng, lat = _transformer.transform(easting, northing)
    return lat, lng


def parse_point_wkt(wkt_str: str) -> tuple[float, float]:
    """Parse POINT WKT in EPSG:25832, return (lat, lng) in WGS84."""
    geom = shapely_wkt.loads(wkt_str)
    return _to_wgs84(geom.x, geom.y)


def polygon_centroid_wgs84(wkt_str: str) -> tuple[float, float]:
    """Compute centroid of POLYGON WKT in EPSG:25832, return (lat, lng) in WGS84."""
    geom = shapely_wkt.loads(wkt_str)
    c = geom.centroid
    return _to_wgs84(c.x, c.y)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in metres between two WGS84 points."""
    R = 6_371_000
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))
