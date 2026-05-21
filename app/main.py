from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import mobility, trips

app = FastAPI(title="Hackathon Rove AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mobility.router)
app.include_router(trips.router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"status": "ok", "message": "Hackathon Rove AI API is running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}
