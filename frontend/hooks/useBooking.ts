import { useState, useCallback, useRef } from 'react';
import { BookingState, TripSearchResponse, TripBookResponse } from '../types/booking';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

const INITIAL: BookingState = {
  phase:             'idle',
  destination:       null,
  destination_coords: null,
  modalities:        [],
  bookingOptionId:   null,
  confirmation:      null,
  error:             null,
};

export function useBooking() {
  const [state, setState] = useState<BookingState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  // ── Discovery phase ─────────────────────────────────────────────────────────

  const search = useCallback(async (destination: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({
      ...INITIAL,
      phase: 'searching',
    });

    try {
      const res = await fetch(`${API_BASE}/api/trips/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Ricerca fallita (${res.status})`);
      }

      const data: TripSearchResponse = await res.json();

      setState({
        phase:              'selecting',
        destination:        data.destination,
        destination_coords: data.destination_coords,
        modalities:         data.modalities,
        bookingOptionId:    null,
        confirmation:       null,
        error:              null,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState({ ...INITIAL, error: String(err) });
    }
  }, []);

  // ── Commit phase ────────────────────────────────────────────────────────────

  const book = useCallback(async (option_id: string) => {
    setState((prev) => ({
      ...prev,
      phase:           'booking',
      bookingOptionId: option_id,
      error:           null,
    }));

    try {
      const res = await fetch(`${API_BASE}/api/trips/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Prenotazione fallita (${res.status})`);
      }

      const data: TripBookResponse = await res.json();

      setState((prev) => ({
        ...prev,
        phase:           'confirmed',
        bookingOptionId: null,
        confirmation:    data,
        error:           null,
      }));
    } catch (err) {
      // Roll back to the selection list so the user can retry or pick another
      setState((prev) => ({
        ...prev,
        phase:           'selecting',
        bookingOptionId: null,
        error:           String(err),
      }));
    }
  }, []);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { state, search, book, dismiss };
}
