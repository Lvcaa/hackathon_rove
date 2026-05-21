from fastapi import APIRouter, HTTPException

from app.database import get_db

router = APIRouter(prefix="/parking", tags=["parking"])


def _status(max_cap: int, available: int) -> str:
    if max_cap == 0:
        return "unknown"
    if available == 0:
        return "full"
    if available / max_cap < 0.2:
        return "low"
    return "ok"


@router.get("")
def list_parking():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, centroid_lat, centroid_lng, max_capacity, available_spots, updated_at FROM parking_zones"
        ).fetchall()
    return {
        "zones": [
            {
                "id": r["id"],
                "name": r["name"],
                "lat": r["centroid_lat"],
                "lng": r["centroid_lng"],
                "max_capacity": r["max_capacity"],
                "available_spots": r["available_spots"],
                "status": _status(r["max_capacity"], r["available_spots"]),
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
    }


@router.get("/{parking_id}")
def get_parking(parking_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, centroid_lat, centroid_lng, max_capacity, available_spots, updated_at FROM parking_zones WHERE id = ?",
            (parking_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Parking zone not found")
    return {
        "id": row["id"],
        "name": row["name"],
        "lat": row["centroid_lat"],
        "lng": row["centroid_lng"],
        "max_capacity": row["max_capacity"],
        "available_spots": row["available_spots"],
        "status": _status(row["max_capacity"], row["available_spots"]),
        "updated_at": row["updated_at"],
    }
