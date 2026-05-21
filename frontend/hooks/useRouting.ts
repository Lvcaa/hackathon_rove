import { useState, useCallback, useRef } from 'react';
import { RouteResponse } from '../types/routing';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export type RoutingStatus = 'idle' | 'loading' | 'ready' | 'error';

interface Origin { lat: number; lng: number; }
interface Destination { name: string; lat?: number; lng?: number; }

/**
 * Fetches ranked multimodal itineraries from POST /api/routing/suggest.
 * When the destination carries coordinates they are sent so the backend
 * routes to the exact point; otherwise only the name is sent and the backend
 * resolves it (catalogue match, then address geocoding).
 */
export function useRouting() {
  const [status, setStatus] = useState<RoutingStatus>('idle');
  const [response, setResponse] = useState<RouteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchRoutes = useCallback(async (origin: Origin, destination: Destination) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStatus('loading');
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/routing/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: origin.lat, lng: origin.lng },
          destination: destination.name,
          destination_coords:
            destination.lat != null && destination.lng != null
              ? { lat: destination.lat, lng: destination.lng }
              : null,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Calcolo percorso fallito (${res.status})`);
      }

      const data: RouteResponse = await res.json();
      setResponse(data);
      setStatus('ready');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setResponse(null);
      setError(String((err as Error).message ?? err));
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
    setResponse(null);
    setError(null);
  }, []);

  return { status, response, error, fetchRoutes, reset };
}
