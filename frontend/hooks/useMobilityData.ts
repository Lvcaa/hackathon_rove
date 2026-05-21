import { useState, useEffect, useRef } from 'react';
import { MobilityData, Stats, BusVehicle, MobilityCollection } from '../types/mobility';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const BUS_REFRESH_MS = 3_000;

// ── Mock data (Trento coordinates from CSV files) ───────────────────────────

const MOCK: MobilityData = {
  stations: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1185, 46.0716] }, properties: { nome: 'FS - Trento', tratta: 'FFSS' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1191, 46.0733] }, properties: { nome: 'FTM - Trento', tratta: 'FTM' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1126, 46.0870] }, properties: { nome: 'FTM - Commerciale', tratta: 'FTM' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1064, 46.1027] }, properties: { nome: 'FTM - Gardolo', tratta: 'FTM' } },
    ],
  },
  taxi: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.12323, 46.064461] }, properties: { nome: 'Taxi – Via S. Croce', indirizzo: 'via S.Croce n. 26' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.11596, 46.059791] }, properties: { nome: 'Taxi – Via della Scienza', indirizzo: 'via della Scienza e del Lavoro' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.121362, 46.072017] }, properties: { nome: 'Taxi – Piazza Dante', indirizzo: 'piazza Dante, 9' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.123907, 46.074755] }, properties: { nome: 'Taxi – Via Petrarca', indirizzo: 'via Petrarca 8' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1254, 46.0681] }, properties: { nome: 'Taxi – Largo Carducci', indirizzo: 'largo Carducci' } },
    ],
  },
  carsharing: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1210, 46.0837] }, properties: { via: 'via Soteri', auto: '1', ordinanza: 'n° 4_2016' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1156, 46.0598] }, properties: { via: 'corso del Lavoro e della Scienza', auto: '1', ordinanza: 'n°810-2013' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1241, 46.0626] }, properties: { via: 'via S. Croce', auto: '1', ordinanza: 'n°571-2010' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1215, 46.0683] }, properties: { via: 'Piazza Dante', auto: '1', ordinanza: 'n°924-2011' } },
    ],
  },
  parking: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[11.118, 46.074], [11.122, 46.074], [11.122, 46.077], [11.118, 46.077], [11.118, 46.074]]] }, properties: { zona: 'cblu2', descrizione: 'Seconda corona blu', pianopark: 10 } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[11.108, 46.059], [11.115, 46.059], [11.115, 46.065], [11.108, 46.065], [11.108, 46.059]]] }, properties: { zona: 'viola', descrizione: 'Area periferica viola Bolghera', pianopark: 14 } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[11.113, 46.064], [11.119, 46.064], [11.119, 46.070], [11.113, 46.070], [11.113, 46.064]]] }, properties: { zona: 'verde', descrizione: 'ZTL verde', pianopark: 2 } },
    ],
  },
};

// Mock bus stops — a handful spread across Trento until real data loads
const MOCK_BUSSTOPS: MobilityCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1185, 46.0716] }, properties: { nome: 'Stazione FS', routes: '5 B 6', kind: 'urban' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1213, 46.0718] }, properties: { nome: 'Piazza Dante', routes: '5 B 8', kind: 'urban' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1241, 46.0643] }, properties: { nome: 'Piazza Venezia', routes: '5 B', kind: 'urban' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1139, 46.0870] }, properties: { nome: 'FTM Commerciale', routes: '8', kind: 'urban' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1364, 46.0693] }, properties: { nome: 'Via Venezia / Corallo', routes: '13', kind: 'extraurban' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1395, 46.0671] }, properties: { nome: 'Mesiano / Facoltà Ingegneria', routes: '13', kind: 'extraurban' } },
  ],
};

// Simulated live buses (mirrors the backend logic, runs in frontend when no backend)
function simulateBuses(t: number): BusVehicle[] {
  const routes: Record<string, { kind: 'urban' | 'extraurban'; wps: [number, number][] }> = {
    '5': { kind: 'extraurban', wps: [[46.108, 11.107], [46.088, 11.116], [46.072, 11.121], [46.059, 11.128], [46.052, 11.132]] },
    'B': { kind: 'urban', wps: [[46.071, 11.118], [46.073, 11.121], [46.068, 11.124], [46.066, 11.119], [46.071, 11.118]] },
    '13': { kind: 'extraurban', wps: [[46.072, 11.118], [46.070, 11.134], [46.067, 11.151], [46.066, 11.158]] },
    '8': { kind: 'urban', wps: [[46.072, 11.121], [46.082, 11.117], [46.090, 11.114], [46.097, 11.111]] },
  };
  const period = 600;
  const buses: BusVehicle[] = [];
  for (const [line, { kind, wps }] of Object.entries(routes)) {
    for (let i = 0; i < 3; i++) {
      const offset = i * (period / 3);
      const frac = ((t + offset) % period) / period;
      const segCount = wps.length - 1;
      const segIdx = Math.min(Math.floor(frac * segCount), segCount - 1);
      const segFrac = (frac * segCount) - segIdx;
      const a = wps[segIdx], b = wps[segIdx + 1];
      const lat = a[0] + segFrac * (b[0] - a[0]);
      const lon = a[1] + segFrac * (b[1] - a[1]);
      const bearing = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 360) % 360;
      buses.push({ id: `bus-${line}-${i}`, lat, lon, bearing, route: line, speed: 30 + (i * 5), kind, live: true });
    }
  }
  return buses;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMobilityData() {
  const [data, setData] = useState<MobilityData>(MOCK);
  const [busStops, setBusStops] = useState<MobilityCollection>(MOCK_BUSSTOPS);
  const [busVehicles, setBusVehicles] = useState<BusVehicle[]>(() => simulateBuses(Date.now() / 1000));
  const [stats, setStats] = useState<Stats>({
    stations: MOCK.stations.features.length,
    taxi: MOCK.taxi.features.length,
    carsharing: MOCK.carsharing.features.length,
    parking_zones: MOCK.parking.features.length,
    busstops: MOCK_BUSSTOPS.features.length,
    buses_live: 12,
  });
  const [loading, setLoading] = useState(true);
  const backendAvailable = useRef(false);

  // Fetch static mobility data once
  useEffect(() => {
    async function fetchStatic() {
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 5000);
        const [sR, tR, cR, pR, stR] = await Promise.all([
          fetch(`${API_BASE}/api/stations`, { signal: ctrl.signal }),
          fetch(`${API_BASE}/api/taxi`, { signal: ctrl.signal }),
          fetch(`${API_BASE}/api/carsharing`, { signal: ctrl.signal }),
          fetch(`${API_BASE}/api/parking`, { signal: ctrl.signal }),
          fetch(`${API_BASE}/api/stats`, { signal: ctrl.signal }),
        ]);
        clearTimeout(timeout);
        const [stations, taxi, carsharing, parking, statsData] = await Promise.all([
          sR.json(), tR.json(), cR.json(), pR.json(), stR.json(),
        ]);
        setData({ stations, taxi, carsharing, parking });
        setStats((prev) => ({ ...prev, ...statsData }));
        backendAvailable.current = true;
      } catch {
        // use mock
      } finally {
        setLoading(false);
      }
    }
    fetchStatic();
  }, []);

  // Fetch GTFS bus stops once (served from backend memory — fast)
  useEffect(() => {
    async function fetchBusStops() {
      try {
        const res = await fetch(`${API_BASE}/api/busstops`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return;
        const col: MobilityCollection = await res.json();
        if (col.features.length > 0) {
          setBusStops(col);
          setStats((prev) => ({ ...prev, busstops: col.features.length }));
        }
      } catch {
        // keep mock bus stops
      }
    }
    fetchBusStops();
  }, []);

  // Refresh live bus positions every 15 s
  useEffect(() => {
    async function fetchBuses() {
      if (backendAvailable.current) {
        try {
          const res = await fetch(`${API_BASE}/api/buses/live`);
          if (!res.ok) throw new Error('not ok');
          const col: { features: { geometry: { coordinates: number[] }; properties: Record<string, string | number | boolean> }[] } = await res.json();
          const vehicles: BusVehicle[] = col.features.map((f) => ({
            id: String(f.properties.id),
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0],
            bearing: Number(f.properties.bearing),
            route: String(f.properties.route),
            speed: Number(f.properties.speed),
            kind: f.properties.kind === 'extraurban' ? 'extraurban' : 'urban',
            live: f.properties.live !== false,
            delay: f.properties.delay != null ? Number(f.properties.delay) : undefined,
            headsign: f.properties.headsign != null ? String(f.properties.headsign) : undefined,
          }));
          setBusVehicles(vehicles);
          setStats((prev) => ({ ...prev, buses_live: vehicles.length }));
          return;
        } catch {
          // fall through to simulation
        }
      }
      // Simulate in-browser when backend unavailable
      setBusVehicles(simulateBuses(Date.now() / 1000));
    }

    fetchBuses();
    const id = setInterval(fetchBuses, BUS_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  return { data, busStops, busVehicles, stats, loading };
}
