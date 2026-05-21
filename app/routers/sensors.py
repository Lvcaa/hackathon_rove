from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.database import get_db
from app.models import SensorUpdateRequest

router = APIRouter(prefix="/sensors", tags=["sensors"])


@router.post("/parking/{parking_id}")
def update_sensor(parking_id: str, body: SensorUpdateRequest):
    with get_db() as conn:
        zone = conn.execute(
            "SELECT id, max_capacity FROM parking_zones WHERE id = ?", (parking_id,)
        ).fetchone()

        if not zone:
            raise HTTPException(status_code=404, detail="Parking zone not found")

        if zone["max_capacity"] == 0:
            raise HTTPException(
                status_code=400,
                detail="Max capacity not configured. Set it via PUT /admin/parking/{id}/capacity first.",
            )

        if body.available_spots < 0 or body.available_spots > zone["max_capacity"]:
            raise HTTPException(
                status_code=400,
                detail=f"available_spots must be between 0 and {zone['max_capacity']}",
            )

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE parking_zones SET available_spots = ?, updated_at = ? WHERE id = ?",
            (body.available_spots, now, parking_id),
        )

    return {
        "parking_id": parking_id,
        "available_spots": body.available_spots,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
