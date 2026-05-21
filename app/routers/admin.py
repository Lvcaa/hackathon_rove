"""Protected admin panel at /admin."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from app.auth import verify_admin
from app.database import get_db
from app.models import SetCapacityRequest
from app.routers.mobility import get_stats

_DISTRESS_THRESHOLD = 0.2

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_html(stats: dict) -> str:
    cards = [
        ("Stazioni", stats["stations"], "#00e5ff"),
        ("Taxi", stats["taxi"], "#fbbf24"),
        ("Car sharing", stats["carsharing"], "#a78bfa"),
        ("Zone parcheggio", stats["parking_zones"], "#34d399"),
    ]
    card_html = "".join(
        f"""
        <article class="card" style="--accent:{color}">
          <p class="label">{label}</p>
          <p class="value">{value}</p>
        </article>
        """
        for label, value, color in cards
    )
    return f"""<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CommuteSync Admin</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: system-ui, -apple-system, sans-serif;
      background: #0d0d0d;
      color: #f5f5f5;
      min-height: 100vh;
      padding: 2rem;
    }}
    h1 {{ font-size: 1.75rem; font-weight: 800; margin-bottom: 0.25rem; }}
    .subtitle {{ color: #9ca3af; margin-bottom: 2rem; font-size: 0.95rem; }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      max-width: 960px;
    }}
    .card {{
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 1.25rem;
      box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 25%, transparent);
    }}
    .label {{ color: #9ca3af; font-size: 0.85rem; margin-bottom: 0.5rem; }}
    .value {{ font-size: 2.5rem; font-weight: 800; color: var(--accent); }}
  </style>
</head>
<body>
  <h1>CommuteSync</h1>
  <p class="subtitle">Pannello amministratore</p>
  <section class="grid">{card_html}</section>
</body>
</html>"""


@router.get("", response_class=HTMLResponse)
def admin_panel(_username: str = Depends(verify_admin)) -> HTMLResponse:
    """Admin dashboard (requires HTTP Basic auth)."""
    return HTMLResponse(_admin_html(get_stats()))


@router.get("/stats")
def admin_stats(_username: str = Depends(verify_admin)) -> dict:
    """JSON stats for admin clients (same data as public /api/stats)."""
    return get_stats()


# ---------------------------------------------------------------------------
# Sensor capacity management
# ---------------------------------------------------------------------------


@router.get("/parking")
def admin_list_parking(_username: str = Depends(verify_admin)) -> dict:
    """List all parking zones with their configured capacity and live availability."""
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
                "capacity_configured": r["max_capacity"] > 0,
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
    }


@router.put("/parking/{parking_id}/capacity")
def set_capacity(
    parking_id: str,
    body: SetCapacityRequest,
    _username: str = Depends(verify_admin),
) -> dict:
    """Set the maximum capacity for a parking zone. Also resets available_spots to max."""
    if body.max_capacity < 0:
        raise HTTPException(status_code=400, detail="max_capacity must be >= 0")

    with get_db() as conn:
        zone = conn.execute(
            "SELECT id FROM parking_zones WHERE id = ?", (parking_id,)
        ).fetchone()
        if not zone:
            raise HTTPException(status_code=404, detail="Parking zone not found")

        conn.execute(
            "UPDATE parking_zones SET max_capacity = ?, available_spots = ?, updated_at = ? WHERE id = ?",
            (body.max_capacity, body.max_capacity, datetime.now(timezone.utc).isoformat(), parking_id),
        )

    return {"parking_id": parking_id, "max_capacity": body.max_capacity}


@router.get("/dashboard")
def dashboard(_username: str = Depends(verify_admin)) -> dict:
    """Aggregated occupancy data for the admin heatmap panel."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, max_capacity, available_spots FROM parking_zones"
        ).fetchall()

    zones = []
    distressed = full = 0

    for r in rows:
        if r["max_capacity"] > 0:
            ratio = r["available_spots"] / r["max_capacity"]
            occupancy_pct = round((1 - ratio) * 100)
            is_distress = ratio < _DISTRESS_THRESHOLD
            is_full = r["available_spots"] == 0
        else:
            occupancy_pct = 0
            is_distress = False
            is_full = False

        if is_distress:
            distressed += 1
        if is_full:
            full += 1

        zones.append(
            {
                "id": r["id"],
                "name": r["name"],
                "max_capacity": r["max_capacity"],
                "available_spots": r["available_spots"],
                "occupancy_pct": occupancy_pct,
                "distress": is_distress,
            }
        )

    return {
        "zones": zones,
        "summary": {
            "total_zones": len(zones),
            "configured_zones": sum(1 for r in rows if r["max_capacity"] > 0),
            "distressed": distressed,
            "full": full,
        },
    }
