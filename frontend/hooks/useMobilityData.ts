import { useState, useEffect } from 'react';
import { MobilityData, Stats } from '../types/mobility';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

const empty = (): MobilityData => ({
  stations: { type: 'FeatureCollection', features: [] },
  taxi: { type: 'FeatureCollection', features: [] },
  carsharing: { type: 'FeatureCollection', features: [] },
  parking: { type: 'FeatureCollection', features: [] },
});

export function useMobilityData() {
  const [data, setData] = useState<MobilityData>(empty());
  const [stats, setStats] = useState<Stats>({ stations: 0, taxi: 0, carsharing: 0, parking_zones: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [stationsRes, taxiRes, carsharingRes, parkingRes, statsRes] = await Promise.all([
          fetch(`${API_BASE}/api/stations`),
          fetch(`${API_BASE}/api/taxi`),
          fetch(`${API_BASE}/api/carsharing`),
          fetch(`${API_BASE}/api/parking`),
          fetch(`${API_BASE}/api/stats`),
        ]);
        const [stations, taxi, carsharing, parking, statsData] = await Promise.all([
          stationsRes.json(),
          taxiRes.json(),
          carsharingRes.json(),
          parkingRes.json(),
          statsRes.json(),
        ]);
        setData({ stations, taxi, carsharing, parking });
        setStats(statsData);
      } catch (e) {
        setError('Impossibile caricare i dati di mobilità');
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  return { data, stats, loading, error };
}
