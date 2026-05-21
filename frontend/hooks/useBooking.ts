import { useState, useCallback, useRef } from 'react';
import { BookingState, TripSearchResponse, TripBookResponse } from '../types/booking';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

const INITIAL: BookingState = {
  phase: 'idle',
  option: null,
  confirmation: null,
  error: null,
};

export function useBooking() {
  const [state, setState] = useState<BookingState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (destination: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({ phase: 'searching', option: null, confirmation: null, error: null });

    try {
      const res = await fetch(`${API_BASE}/api/trips/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Search failed (${res.status})`);
      }

      const data: TripSearchResponse = await res.json();
      setState({ phase: 'option', option: data, confirmation: null, error: null });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState({ phase: 'idle', option: null, confirmation: null, error: String(err) });
    }
  }, []);

  const book = useCallback(async (option_id: string) => {
    setState((prev) => ({ ...prev, phase: 'booking', error: null }));

    try {
      const res = await fetch(`${API_BASE}/api/trips/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Booking failed (${res.status})`);
      }

      const data: TripBookResponse = await res.json();
      setState((prev) => ({ ...prev, phase: 'confirmed', confirmation: data, error: null }));
    } catch (err) {
      // Roll back to option view so the user can retry
      setState((prev) => ({ ...prev, phase: 'option', error: String(err) }));
    }
  }, []);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { state, search, book, dismiss };
}
