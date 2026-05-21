// ── Request payloads ──────────────────────────────────────────────────────────

export interface TripSearchPayload {
  destination: string;
}

export interface TripBookPayload {
  option_id: string;
}

// ── Search response ───────────────────────────────────────────────────────────

export interface TrainInfo {
  departure_time: string;
  track: string;
  platform: number;
  available_seats: number;
  total_seats: number;
}

export interface ParkingInfo {
  zone: string;
  description: string;
  free_spots: number;
  total_spots: number;
  distance_meters: number;
}

export interface BikeSharingInfo {
  station_name: string;
  available_bikes: number;
  available_docks: number;
  distance_meters: number;
}

export interface TripSearchResponse {
  option_id: string;
  destination: string;
  destination_coords: [number, number];
  expires_at: string;
  train: TrainInfo;
  parking: ParkingInfo;
  bike_sharing: BikeSharingInfo;
  price_eur: number;
  route_waypoints: [number, number][];
}

// ── Book response ─────────────────────────────────────────────────────────────

export interface BoardingPass {
  booking_id: string;
  passenger: string;
  qr_payload: string;
  train_code: string;
  origin: string;
  destination: string;
  departure_time: string;
  platform: number;
  seat: string;
  validity: string;
  route_waypoints: [number, number][];
  destination_coords: [number, number];
}

export interface TripBookResponse {
  booking_id: string;
  option_id: string;
  status: 'BOOKED';
  confirmed_at: string;
  boarding_pass: BoardingPass;
}

// ── Booking state machine ─────────────────────────────────────────────────────

export type BookingPhase = 'idle' | 'searching' | 'option' | 'booking' | 'confirmed';

export interface BookingState {
  phase: BookingPhase;
  option: TripSearchResponse | null;
  confirmation: TripBookResponse | null;
  error: string | null;
}
