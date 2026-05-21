from fastapi import APIRouter

from app.database import get_db

router = APIRouter(prefix="/sharing", tags=["sharing"])


@router.get("")
def list_sharing():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, address, type, lat, lng, available FROM sharing_points"
        ).fetchall()
    return {
        "points": [
            {
                "id": r["id"],
                "address": r["address"],
                "type": r["type"],
                "lat": r["lat"],
                "lng": r["lng"],
                "available": bool(r["available"]),
            }
            for r in rows
        ]
    }
