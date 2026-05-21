from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import admin, mobility, transit
from app.routers import ai, destinations, parking, sensors, sharing, trips

app = FastAPI(title="CommuteSync API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


# GeoJSON / legacy data endpoints
app.include_router(mobility.router)
app.include_router(transit.router)
app.include_router(admin.router)

# Booking system
app.include_router(ai.router)
app.include_router(trips.router)
app.include_router(destinations.router)
app.include_router(parking.router)
app.include_router(sharing.router)
app.include_router(sensors.router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"status": "ok", "message": "CommuteSync API is running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}
