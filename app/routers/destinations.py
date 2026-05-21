from fastapi import APIRouter
from rapidfuzz import fuzz, process, utils as fuzz_utils

from app.database import get_db

router = APIRouter(prefix="/destinations", tags=["destinations"])


@router.get("/search")
def search_destinations(q: str):
    with get_db() as conn:
        rows = conn.execute("SELECT id, name, type, lat, lng FROM destinations").fetchall()

    if not rows:
        return {"results": []}

    choices = {row["id"]: row["name"] for row in rows}
    matches = process.extract(
        q, choices,
        scorer=fuzz.WRatio,
        processor=fuzz_utils.default_process,
        limit=5,
        score_cutoff=30,
    )
    matched_ids = {key for _, _, key in matches}

    return {
        "results": [
            {"id": r["id"], "name": r["name"], "type": r["type"], "lat": r["lat"], "lng": r["lng"]}
            for r in rows
            if r["id"] in matched_ids
        ]
    }
