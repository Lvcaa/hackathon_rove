import { useState, useCallback, useRef, useEffect } from 'react';

export interface LiveLocation {
  lat: number;
  lng: number;
  accuracy: number;   // meters
  heading: number | null;
  timestamp: number;
}

// idle → locating → tracking ; error reachable from locating
export type LocationStatus = 'idle' | 'locating' | 'tracking' | 'error';

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 15000,
};

/**
 * Watches the device's live position via the browser Geolocation API.
 * `start` begins a continuous watch; `stop` ends it. The watch is also
 * cleared on unmount so no stray callbacks fire after the screen is gone.
 */
export function useLiveLocation() {
  const [location, setLocation] = useState<LiveLocation | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  const clearWatch = useCallback(() => {
    if (watchId.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('error');
      setError('Geolocalizzazione non supportata da questo dispositivo');
      return;
    }
    if (watchId.current !== null) return;  // already watching

    setStatus('locating');
    setError(null);

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          timestamp: pos.timestamp,
        });
        setStatus('tracking');
        setError(null);
      },
      (err) => {
        clearWatch();
        setStatus('error');
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Permesso di localizzazione negato'
            : err.code === err.TIMEOUT
            ? 'Posizione non trovata — riprova'
            : 'Posizione non disponibile',
        );
      },
      GEO_OPTIONS,
    );
  }, [clearWatch]);

  const stop = useCallback(() => {
    clearWatch();
    setStatus('idle');
    setLocation(null);
    setError(null);
  }, [clearWatch]);

  useEffect(() => clearWatch, [clearWatch]);

  return { location, status, error, start, stop };
}
