# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**CommuteSync** — an urban mobility orchestration system for Rovereto/Trento. The system chains parking, bike-sharing, and transit resources into a single guaranteed itinerary (like an airport gate system). Data comes from Rovereto Municipality open datasets.

## Environment

The Python backend runs inside Docker. The repo root is mounted at `/workspace` inside every container. Before running any Python, build the image:

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY / OPENAI_API_KEY as needed
make build             # or: docker compose build
```

The frontend (Expo/React Native) runs **locally** (Node), not in Docker.

## Common Commands

**Backend (Docker):**
```bash
make api         # FastAPI at http://localhost:8000 (--reload enabled)
make shell       # Interactive bash in the container
make test        # pytest
make lint        # ruff check .
make format      # black .
make down        # stop all containers
```

**Frontend (local):**
```bash
cd frontend
npm install      # first time only
npm run web      # Expo web at http://localhost:8081
npm run ios      # iOS simulator
npm run android  # Android emulator
```

Rebuild Python image after changing `requirements.txt`:
```bash
docker compose build --no-cache
```

## Architecture

### Backend — `app/`

- `app/main.py` — FastAPI entry point; registers the `mobility` and `transit` routers and CORS middleware (allows all origins for hackathon convenience).
- `app/routers/mobility.py` — CSV data endpoints + live bus simulation. CSVs from `dataset/` are parsed **once at module import time** and cached in memory as GeoJSON FeatureCollections. Coordinates are transformed from UTM zone 32N (EPSG:32632) to WGS84 on load.
- `app/routers/transit.py` — Trentino Trasporti GTFS. The official urban GTFS zip is downloaded once (cached in `dataset/gtfs/`, gitignored), parsed at import time into in-memory indexes, and serves real bus stops, routes, and per-stop departure schedules. Service-day filtering uses `calendar.txt` + `calendar_dates.txt`; the reference clock is Europe/Rome.

**API endpoints:**
| Route | Description |
|---|---|
| `GET /api/stations` | Train/tram stations (Point features) |
| `GET /api/taxi` | Taxi stands (Point features) |
| `GET /api/carsharing` | Car-sharing spots (Point features) |
| `GET /api/parking` | Parking zones (Polygon features) |
| `GET /api/stats` | Feature counts per category |
| `GET /api/buses/live` | Simulated live bus positions along Trento routes |
| `GET /api/busstops` | GTFS bus stops (Point features; `stop_id`, `routes`) |
| `GET /api/routes` | All urban bus lines with official display colors |
| `GET /api/busstops/{stop_id}/schedule` | Scheduled departures from a stop; optional `?time=HH:MM&limit=N` |

**Datasets** in `dataset/` (CSV, semicolon-separated):
- `stazioni.csv` — stations; geometry in WKT POINT, UTM 32N
- `taxi.csv` — taxi stands; already WGS84 (`x`=lat, `y`=lon columns)
- `car_sharing.csv` — car-sharing spots; WKT POINT, UTM 32N
- `zone_parcheggio.csv` — parking zones; WKT POLYGON, UTM 32N
- `dataset/gtfs/` — Trentino Trasporti urban GTFS zip, auto-downloaded by `transit.py` on first start (gitignored)

### Frontend — `frontend/`

Expo (React Native + web) app using `expo-router` for file-based routing.

- `app/index.tsx` — landing/home screen
- `app/dashboard.tsx` — B2G admin dashboard with stats cards
- `app/_layout.tsx` — root layout
- `components/MapView.tsx` — native map; `MapView.web.tsx` — Leaflet map for web
- `hooks/useMobilityData.ts` — fetches all endpoints in parallel; falls back to hardcoded mock data (Trento coordinates) if the backend is unreachable within 4 seconds
- `types/mobility.ts` — shared TypeScript types (`MobilityFeature`, `MobilityData`, `Stats`, etc.)
- `constants/colors.ts` — design system color tokens

Set `EXPO_PUBLIC_API_URL` in the frontend env (defaults to `http://localhost:8000`) to point at a different backend.

## Key Patterns

- **Coordinate conversion:** All UTM→WGS84 conversion happens in `mobility.py` at startup. Never store raw UTM coordinates in the frontend.
- **Mock fallback:** `useMobilityData` initialises state with `MOCK` data and only replaces it on a successful fetch, so the UI is always functional even without the backend.
- **Platform-split components:** Files ending in `.web.tsx` override their `.tsx` counterpart on web builds (Expo's platform extension convention).
