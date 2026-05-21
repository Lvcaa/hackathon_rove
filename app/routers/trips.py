import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from rapidfuzz import fuzz, process

from app.cache import retrieve_option, store_option
from app.database import get_db
from app.geo import haversine_m
from app.models import TripBookRequest, TripSearchRequest

router = APIRouter(prefix="/trips", tags=["trips"])

_WALK_MPS = 1.4    # pedestrian walking speed
_CAR_MPS = 8.33    # ~30 km/h average city car speed


def _match_destination(query: str, conn) -> dict | None:
    rows = conn.execute("SELECT id, name, type, lat, lng FROM destinations").fetchall()
    if not rows:
        return None
    choices = {row["id"]: row["name"] for row in rows}
    result = process.extractOne(query, choices, scorer=fuzz.WRatio, score_cutoff=30)
    if not result:
        return None
    _, _, matched_id = result
    for row in rows:
        if row["id"] == matched_id:
            return dict(row)
    return None


@router.post("/search")
def search_trips(body: TripSearchRequest):
    with get_db() as conn:
        destination = _match_destination(body.destination, conn)
        if not destination:
            raise HTTPException(status_code=404, detail=f"Destination '{body.destination}' not found")

        parking_rows = conn.execute(
            "SELECT id, name, centroid_lat, centroid_lng, max_capacity, available_spots FROM parking_zones"
        ).fetchall()
        sharing_rows = conn.execute(
            "SELECT id, address, type, lat, lng FROM sharing_points WHERE available = 1"
        ).fetchall()

    if not sharing_rows:
        raise HTTPException(status_code=503, detail="No sharing vehicles currently available")

    dest_lat, dest_lng = destination["lat"], destination["lng"]
    sharing = [dict(s) for s in sharing_rows]

    ranked_parking = sorted(
        [(dict(p), haversine_m(p["centroid_lat"], p["centroid_lng"], dest_lat, dest_lng)) for p in parking_rows],
        key=lambda x: x[1],
    )

    now = datetime.now()
    options = []

    for parking, park_to_dest_m in ranked_parking[:10]:
        nearest = min(
            sharing,
            key=lambda s: haversine_m(s["lat"], s["lng"], parking["centroid_lat"], parking["centroid_lng"]),
        )
        sh_to_park_m = haversine_m(nearest["lat"], nearest["lng"], parking["centroid_lat"], parking["centroid_lng"])
        sh_to_dest_m = haversine_m(nearest["lat"], nearest["lng"], dest_lat, dest_lng)

        t1 = now + timedelta(minutes=5)
        t2 = t1 + timedelta(seconds=sh_to_park_m / _WALK_MPS)
        t3 = t2 + timedelta(seconds=sh_to_dest_m / _CAR_MPS)

        option_data = {
            "destination": destination,
            "parking": dict(parking),
            "sharing": nearest,
            "steps": [
                {
                    "step": 1,
                    "action": f"Parcheggia in {parking['name']}",
                    "time": t1.strftime("%H:%M"),
                    "detail": f"{int(park_to_dest_m)}m dalla destinazione",
                },
                {
                    "step": 2,
                    "action": f"Sblocca {nearest['type']} sharing — {nearest['address']}",
                    "time": t2.strftime("%H:%M"),
                    "detail": f"{int(sh_to_park_m)}m dal parcheggio",
                },
                {
                    "step": 3,
                    "action": f"Arrivo a {destination['name']}",
                    "time": t3.strftime("%H:%M"),
                    "detail": f"{int(sh_to_dest_m)}m in {nearest['type']} sharing",
                },
            ],
        }
        option_id = store_option(option_data)

        options.append(
            {
                "option_id": option_id,
                "parking": {
                    "id": parking["id"],
                    "name": parking["name"],
                    "available_spots": parking["available_spots"],
                    "distance_m": int(park_to_dest_m),
                },
                "sharing": {
                    "id": nearest["id"],
                    "type": nearest["type"],
                    "address": nearest["address"],
                    "distance_from_parking_m": int(sh_to_park_m),
                },
                "estimated_minutes": int((t3 - now).total_seconds() / 60),
            }
        )

        if len(options) >= 3:
            break

    return {
        "destination": {"name": destination["name"], "lat": destination["lat"], "lng": destination["lng"]},
        "options": options,
    }


@router.post("/book")
def book_trip(body: TripBookRequest):
    option = retrieve_option(body.option_id)
    if not option:
        raise HTTPException(status_code=404, detail="Option expired or not found. Search again.")

    trip_id = f"TRP-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        parking = conn.execute(
            "SELECT id, available_spots, max_capacity FROM parking_zones WHERE id = ?",
            (option["parking"]["id"],),
        ).fetchone()

        if parking and parking["max_capacity"] > 0 and parking["available_spots"] <= 0:
            raise HTTPException(status_code=409, detail="Parking zone is now full. Please search again.")

        conn.execute(
            "INSERT INTO trips (id, destination_id, destination_name, parking_id, sharing_id, status, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                trip_id,
                option["destination"]["id"],
                option["destination"]["name"],
                option["parking"]["id"],
                option["sharing"]["id"],
                "confirmed",
                now_iso,
            ),
        )

        for step in option["steps"]:
            conn.execute(
                "INSERT INTO trip_steps (trip_id, step_order, action, detail, estimated_time) VALUES (?,?,?,?,?)",
                (trip_id, step["step"], step["action"], step["detail"], step["time"]),
            )

        if parking and parking["max_capacity"] > 0 and parking["available_spots"] > 0:
            conn.execute(
                "UPDATE parking_zones SET available_spots = available_spots - 1, updated_at = ? WHERE id = ?",
                (now_iso, option["parking"]["id"]),
            )

        conn.execute("UPDATE sharing_points SET available = 0 WHERE id = ?", (option["sharing"]["id"],))

    return {
        "trip_id": trip_id,
        "status": "confirmed",
        "boarding_pass": {
            "destination": option["destination"]["name"],
            "steps": option["steps"],
        },
    }


@router.get("/{trip_id}")
def get_trip(trip_id: str):
    with get_db() as conn:
        trip = conn.execute(
            "SELECT id, destination_name, parking_id, sharing_id, status, created_at FROM trips WHERE id = ?",
            (trip_id,),
        ).fetchone()

        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        steps = conn.execute(
            "SELECT step_order, action, detail, estimated_time FROM trip_steps WHERE trip_id = ? ORDER BY step_order",
            (trip_id,),
        ).fetchall()

    return {
        "trip_id": trip["id"],
        "status": trip["status"],
        "destination": trip["destination_name"],
        "created_at": trip["created_at"],
        "boarding_pass": {
            "steps": [
                {
                    "step": s["step_order"],
                    "action": s["action"],
                    "detail": s["detail"],
                    "time": s["estimated_time"],
                }
                for s in steps
            ]
        },
    }


@router.delete("/{trip_id}")
def cancel_trip(trip_id: str):
    with get_db() as conn:
        trip = conn.execute(
            "SELECT id, parking_id, sharing_id, status FROM trips WHERE id = ?", (trip_id,)
        ).fetchone()

        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        if trip["status"] == "cancelled":
            raise HTTPException(status_code=409, detail="Trip already cancelled")

        now_iso = datetime.now(timezone.utc).isoformat()

        conn.execute("UPDATE trips SET status = 'cancelled' WHERE id = ?", (trip_id,))

        conn.execute(
            "UPDATE parking_zones SET available_spots = MIN(available_spots + 1, max_capacity), updated_at = ? "
            "WHERE id = ? AND max_capacity > 0",
            (now_iso, trip["parking_id"]),
        )

        conn.execute("UPDATE sharing_points SET available = 1 WHERE id = ?", (trip["sharing_id"],))

    return {"trip_id": trip_id, "status": "cancelled"}
