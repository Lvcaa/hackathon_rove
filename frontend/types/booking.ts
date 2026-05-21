// ── Request payloads ──────────────────────────────────────────────────────────

export interface TripSearchPayload {
  destination: string;
}

export interface TripBookPayload {
  option_id: string;
}

// ── Modality types (discriminated union) ─────────────────────────────────────

export type ModalityType = 'train' | 'parking' | 'taxi' | 'bike_sharing';

interface BaseModality {
  option_id: string;
  type: ModalityType;
  price_eur: number;
  expires_at: string;
}

export interface TrainModality extends BaseModality {
  type: 'train';
  departure_time: string;
  track: string;
  platform: number;
  available_seats: number;
  total_seats: number;
}

export interface ParkingModality extends BaseModality {
  type: 'parking';
  zone: string;
  description: string;
  available_spots: number;
  total_spots: number;
  distance_meters: number;
}

export interface TaxiModality extends BaseModality {
  type: 'taxi';
  eta_minutes: number;
  vehicle_model: string;
  driver_name: string;
  plate: string;
}

export interface BikeSharingModality extends BaseModality {
  type: 'bike_sharing';
  station_name: string;
  available_bikes: number;
  available_docks: number;
  distance_meters: number;
}

export type ModalityOption =
  | TrainModality
  | ParkingModality
  | TaxiModality
  | BikeSharingModality;

// ── Search response ───────────────────────────────────────────────────────────

export interface TripSearchResponse {
  destination: string;
  destination_coords: [number, number];
  route_waypoints: [number, number][];
  modalities: ModalityOption[];
}

// ── Book response — generalised across all modality types ─────────────────────

export interface DetailLine {
  label: string;
  value: string;
}

export interface BoardingPass {
  booking_id: string;
  passenger: string;
  qr_payload: string;
  modality_type: ModalityType;
  title: string;
  subtitle: string;
  origin: string;
  destination: string;
  detail_lines: DetailLine[];
  route_waypoints: [number, number][];
  destination_coords: [number, number];
}

export interface TripBookResponse {
  booking_id: string;
  option_id: string;
  modality_type: ModalityType;
  status: 'BOOKED';
  confirmed_at: string;
  boarding_pass: BoardingPass;
}

// ── Booking state machine ─────────────────────────────────────────────────────

// idle → searching → selecting → booking → confirmed
export type BookingPhase =
  | 'idle'
  | 'searching'
  | 'selecting'
  | 'booking'
  | 'confirmed';

export interface BookingState {
  phase: BookingPhase;
  destination: string | null;
  destination_coords: [number, number] | null;
  modalities: ModalityOption[];
  bookingOptionId: string | null;  // which option_id is currently being committed
  confirmation: TripBookResponse | null;
  error: string | null;
}
