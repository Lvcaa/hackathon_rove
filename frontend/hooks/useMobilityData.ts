import { useState, useEffect } from 'react';
import { MobilityData, Stats } from '../types/mobility';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

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
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1175, 46.0798] }, properties: { nome: 'Taxi – Via Roma', indirizzo: 'via Roma' } },
    ],
  },
  carsharing: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1210, 46.0837] }, properties: { via: 'via Soteri', auto: '1', ordinanza: 'n° 4_2016' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1156, 46.0598] }, properties: { via: 'corso del Lavoro e della Scienza', auto: '1', ordinanza: 'n°810-2013' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1241, 46.0626] }, properties: { via: 'via S. Croce', auto: '1', ordinanza: 'n°571-2010' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1215, 46.0683] }, properties: { via: 'Piazza Dante', auto: '1', ordinanza: 'n°924-2011' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [11.1188, 46.0755] }, properties: { via: 'via Belenzani', auto: '2', ordinanza: 'n°312-2015' } },
    ],
  },
  parking: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[11.118, 46.074], [11.122, 46.074], [11.122, 46.077], [11.118, 46.077], [11.118, 46.074]]],
        },
        properties: { zona: 'cblu2', descrizione: 'Seconda corona blu', pianopark: 10 },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[11.108, 46.059], [11.115, 46.059], [11.115, 46.065], [11.108, 46.065], [11.108, 46.059]]],
        },
        properties: { zona: 'viola', descrizione: 'Area periferica viola Bolghera', pianopark: 14 },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[11.113, 46.064], [11.119, 46.064], [11.119, 46.070], [11.113, 46.070], [11.113, 46.064]]],
        },
        properties: { zona: 'verde', descrizione: 'ZTL verde', pianopark: 2 },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[11.120, 46.063], [11.128, 46.063], [11.128, 46.069], [11.120, 46.069], [11.120, 46.063]]],
        },
        properties: { zona: 'crosso2', descrizione: 'Seconda corona rossa', pianopark: 9 },
      },
    ],
  },
};

const MOCK_STATS: Stats = {
  stations: MOCK.stations.features.length,
  taxi: MOCK.taxi.features.length,
  carsharing: MOCK.carsharing.features.length,
  parking_zones: MOCK.parking.features.length,
};

export function useMobilityData() {
  const [data, setData] = useState<MobilityData>(MOCK);
  const [stats, setStats] = useState<Stats>(MOCK_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const [stationsRes, taxiRes, carsharingRes, parkingRes, statsRes] = await Promise.all([
          fetch(`${API_BASE}/api/stations`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/taxi`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/carsharing`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/parking`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/stats`, { signal: controller.signal }),
        ]);
        clearTimeout(timeout);
        const [stations, taxi, carsharing, parking, statsData] = await Promise.all([
          stationsRes.json(),
          taxiRes.json(),
          carsharingRes.json(),
          parkingRes.json(),
          statsRes.json(),
        ]);
        setData({ stations, taxi, carsharing, parking });
        setStats(statsData);
      } catch {
        // Backend unavailable — mock data already set as default
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  return { data, stats, loading, error };
}
