import { useState, useCallback, useRef } from 'react';
import { BookingState, ModalityType, TripSearchResponse, TripBookResponse } from '../types/booking';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

const INITIAL: BookingState = {
  phase:             'idle',
  destination:       null,
  destination_coords: null,
  modalities:        [],
  bookingOptionId:   null,
  confirmation:      null,
  error:             null,
  directBookingLabel: null,
};

export function useBooking() {
  const [state, setState] = useState<BookingState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  // ── Discovery phase ─────────────────────────────────────────────────────────

  const fetchModalities = useCallback(async (destination: string, signal?: AbortSignal) => {
      const res = await fetch(`${API_BASE}/api/trips/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination }),
        signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Ricerca fallita (${res.status})`);
      }

      return (await res.json()) as TripSearchResponse;
  }, []);

  const postBooking = useCallback(async (option_id: string) => {
    const res = await fetch(`${API_BASE}/api/trips/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ option_id }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? `Prenotazione fallita (${res.status})`);
    }

    return (await res.json()) as TripBookResponse;
  }, []);

  const applyConfirmation = useCallback((data: TripBookResponse) => {
    setState((prev) => {
      const modalities =
        data.modality_type === 'parking' && data.updated_available_spots != null
          ? prev.modalities.map((m) =>
              m.type === 'parking'
                ? { ...m, available_spots: data.updated_available_spots! }
                : m
            )
          : prev.modalities;
      return {
        ...prev,
        phase:           'confirmed',
        bookingOptionId: null,
        confirmation:    data,
        modalities,
        error:           null,
        directBookingLabel: null,
      };
    });
  }, []);

  const search = useCallback(async (destination: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({
      ...INITIAL,
      phase: 'searching',
    });

    try {
      const data = await fetchModalities(destination, ctrl.signal);

      setState({
        phase:              'selecting',
        destination:        data.destination,
        destination_coords: data.destination_coords,
        modalities:         data.modalities,
        bookingOptionId:    null,
        confirmation:       null,
        error:              null,
        directBookingLabel: null,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState({ ...INITIAL, error: String(err) });
    }
  }, [fetchModalities]);

  // ── Commit phase ────────────────────────────────────────────────────────────

  const book = useCallback(async (option_id: string) => {
    setState((prev) => ({
      ...prev,
      phase:           'booking',
      bookingOptionId: option_id,
      error:           null,
    }));

    try {
      const data = await postBooking(option_id);
      applyConfirmation(data);
    } catch (err) {
      // Roll back to the selection list so the user can retry or pick another
      setState((prev) => ({
        ...prev,
        phase:           'selecting',
        bookingOptionId: null,
        error:           String(err),
        directBookingLabel: null,
      }));
    }
  }, [applyConfirmation, postBooking]);

  const bookDestination = useCallback(async (
    destination: string,
    modalityType: ModalityType,
    label?: string,
  ) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({
      ...INITIAL,
      phase: 'searching',
      directBookingLabel: label ?? modalityType,
    });

    try {
      const data = await fetchModalities(destination, ctrl.signal);
      const option = data.modalities.find((m) => m.type === modalityType);

      if (!option) {
        const readable = label ?? modalityType;
        throw new Error(`Nessun ticket prenotabile per ${readable}`);
      }

      setState({
        phase:              'booking',
        destination:        data.destination,
        destination_coords: data.destination_coords,
        modalities:         [option],
        bookingOptionId:    option.option_id,
        confirmation:       null,
        error:              null,
        directBookingLabel: label ?? modalityType,
      });

      const confirmation = await postBooking(option.option_id);
      applyConfirmation(confirmation);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState({
        ...INITIAL,
        error: String(err),
      });
      throw err;
    }
  }, [applyConfirmation, fetchModalities, postBooking]);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { state, search, book, bookDestination, dismiss };
}
