# CommuteSync — Design Spec

**Date:** 2026-05-21  
**Project:** Hackathon Rove — Campionato Universitario AI 2026  
**Context:** Mobile-first mobility PWA for Rovereto municipality open data

---

## 1. Vision

A dark-themed, map-first mobility app (like the "outletbuddy" reference) that opens directly on an interactive map. No marketing splash page — the experience starts immediately with live mobility data from Rovereto/Trento open datasets. Citizens see train stations, taxi stands, car sharing spots, and parking zones on a single map. Administrators get a separate dashboard screen with aggregate stats and charts.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Expo Router + TypeScript (unified web + native) |
| Map (web) | react-leaflet + CartoDB Dark Matter tiles |
| Map (native Expo Go) | WebView wrapping the same Leaflet HTML |
| Backend | FastAPI (Python, Docker) |
| Coordinate conversion | pyproj (UTM 32N → WGS84) |
| Data format | GeoJSON served from FastAPI |
| Design system | Dark theme, glass/blur cards, cyan/yellow/purple/green accent palette |

**Why Expo Router:** Unified codebase for Expo Go (mobile preview) and Expo Web (browser). File-based routing mirrors Next.js App Router feel. TypeScript throughout.

**Why WebView for native map:** react-leaflet does not run natively; wrapping it in a WebView avoids maintaining two map implementations while still allowing Expo Go testing. The web experience is the primary target.

---

## 3. Data Sources

All from the `dataset/` directory (CSV with semicolon delimiter, WKB geometry in EPSG:32632 UTM 32N):

| File | Type | Geometry | Notes |
|---|---|---|---|
| `stazioni.csv` | Train/tram stations | POINT | Fields: nome, tratta |
| `taxi.csv` | Taxi stands | POINT | Already has lat/lon (x, y columns) |
| `car_sharing.csv` | Car sharing spots | POINT | Fields: via, auto, ordinanza |
| `zone_parcheggio.csv` | Parking zones | POLYGON | Fields: zona, descrizione, pianopark |

The backend converts all WKB POINT geometries to WGS84 lat/lon via pyproj. Parking zone polygons are converted from UTM 32N polygon rings to GeoJSON Polygon coordinates.

---

## 4. Backend — FastAPI Endpoints

All endpoints return GeoJSON FeatureCollections. CORS enabled for local Expo dev server.

```
GET /api/stations     → FeatureCollection of train/tram station Points
GET /api/taxi         → FeatureCollection of taxi stand Points
GET /api/carsharing   → FeatureCollection of car sharing Points
GET /api/parking      → FeatureCollection of parking zone Polygons
GET /api/stats        → JSON summary counts per category
GET /health           → existing health check
```

`/api/stats` response shape:
```json
{
  "stations": 8,
  "taxi": 12,
  "carsharing": 5,
  "parking_zones": 34
}
```

---

## 5. Frontend — Screens & Components

### Screen 1: Map (`/`)

The landing experience. Full-screen dark map with:

**Desktop / tablet layout:**
- Left sidebar (fixed width ~220px): search bar, category filter chips, scrollable list of locations
- Right: full-height interactive Leaflet map
- Top-right corner: four glass stat cards (stations, taxi, car sharing, parking)
- Tapping a pin or list item opens a popup card on the map with name, category, distance, and a "Naviga →" CTA

**Mobile layout:**
- Map fills the full screen
- Bottom sheet (draggable handle) shows category filter chips + scrollable location list
- Stat cards collapse into a single horizontal scrollable strip at the top of the bottom sheet

**Category colors & icons:**

| Category | Color | Icon |
|---|---|---|
| Stazioni | `#00e5ff` (cyan) | 🚂 |
| Taxi | `#fbbf24` (yellow) | 🚕 |
| Car sharing | `#a78bfa` (purple) | 🚗 |
| Parcheggi | `#34d399` (green) | 🅿️ |

Parking zones render as semi-transparent filled polygons (not pins) with a colored border matching their zone color from the dataset (`zona` field).

### Screen 2: Admin Dashboard (`/dashboard`)

B2G view. Accessible via a tab or header link. Shows:
- Four metric cards with big number + mini bar chart (one per category, matching category colors)
- Charts styled like the portfolio reference: dark card, glowing accent color, bar/sparkline
- No real-time data for hackathon — stats are fetched once from `/api/stats`

### Navigation

Expo Router tabs or a simple header nav:
- Map (default tab)  
- Dashboard (admin tab)

---

## 6. Design System

**Colors:**
```
Background:    #0d0d0d
Surface:       #111111
Surface-2:     #1a1a1a
Border:        rgba(255,255,255,0.08)
Text primary:  #ffffff
Text muted:    rgba(255,255,255,0.45)

Cyan accent:   #00e5ff   (stations, primary CTA)
Yellow accent: #fbbf24   (taxi)
Purple accent: #a78bfa   (car sharing)
Green accent:  #34d399   (parking)
```

**Glass card pattern:**
```css
background: rgba(17,17,17,0.85);
backdrop-filter: blur(12px);
border: 1px solid rgba(255,255,255,0.1);
border-radius: 12px;
```

**Map tiles:** CartoDB Dark Matter — `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`

**Map center:** Rovereto/Trento area — approximately `[46.07, 11.12]`, zoom 14.

---

## 7. Project Structure

```
hackathon_rove/
├── app/                        # FastAPI backend (existing)
│   ├── main.py                 # Add new API routes here
│   └── routers/
│       └── mobility.py         # New: all /api/* endpoints
├── dataset/                    # CSVs (existing)
├── frontend/                   # New: Expo Router app
│   ├── app/
│   │   ├── _layout.tsx         # Root layout + tab navigator
│   │   ├── index.tsx           # Map screen
│   │   └── dashboard.tsx       # Admin dashboard
│   ├── components/
│   │   ├── MapView.web.tsx     # react-leaflet implementation
│   │   ├── MapView.tsx         # WebView wrapper for native
│   │   ├── Sidebar.tsx         # Desktop sidebar
│   │   ├── BottomSheet.tsx     # Mobile bottom sheet
│   │   ├── LocationCard.tsx    # Popup / list item card
│   │   ├── StatsCard.tsx       # Glass stat overlay card
│   │   ├── CategoryFilter.tsx  # Filter chip row
│   │   └── DashboardCard.tsx   # Admin metric card with chart
│   ├── constants/
│   │   └── colors.ts           # Design system colors
│   ├── hooks/
│   │   └── useMobilityData.ts  # Data fetching hooks
│   ├── types/
│   │   └── mobility.ts         # GeoJSON feature types
│   ├── package.json
│   └── app.json                # Expo config
└── requirements.txt            # Add pyproj
```

---

## 8. Data Flow

```
CSV files (dataset/)
  → FastAPI reads on startup with pandas
  → pyproj converts UTM 32N → WGS84
  → Cached in memory as GeoJSON dicts
  → Served via /api/* endpoints

Expo app (frontend/)
  → useMobilityData hook fetches all endpoints on mount
  → State: { stations, taxi, carsharing, parking, stats }
  → MapView renders markers + polygons from state
  → Sidebar/BottomSheet renders list from same state
  → CategoryFilter toggles visibility per category
```

---

## 9. Error Handling & Scope

- Data is loaded from static CSVs at FastAPI startup — no real-time updates for the hackathon
- If a fetch fails, show a toast and render the map with whatever data loaded successfully
- No authentication on either map or dashboard (hackathon scope)
- No booking / routing logic in this phase — "Naviga →" button is a placeholder CTA
- Parking zone polygon rendering may be simplified to centroid points if coordinate conversion is complex

---

## 10. Out of Scope (this spec)

- Chain booking / transactional routing (described in overview.md — future feature)
- Real-time failover / re-routing
- User accounts / authentication
- Backend persistence (no database — data is read-only from CSVs)
