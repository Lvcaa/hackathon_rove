import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from './useAuth';

export interface Booking {
  booking_id: string;
  destination_name: string;
  parking_id: string | null;
  status: string;
  created_at: string;
}

export function useBookings() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setBookings([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ trips: Booking[] }>('/api/trips');
      setBookings(data.trips);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bookings, loading, error, refresh };
}
