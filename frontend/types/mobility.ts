export interface MobilityFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'Polygon';
    coordinates: number[] | number[][][];
  };
  properties: Record<string, string | number | null>;
}

export interface MobilityCollection {
  type: 'FeatureCollection';
  features: MobilityFeature[];
}

export type CategoryKey =
  | 'stations'
  | 'taxi'
  | 'carsharing'
  | 'parking'
  | 'busstops_urban'
  | 'busstops_extraurban'
  | 'buses'
  | 'trainstations'
  | 'trains';

export interface MobilityData {
  stations: MobilityCollection;
  taxi: MobilityCollection;
  carsharing: MobilityCollection;
  parking: MobilityCollection;
  parkingLots: MobilityCollection;
}

export type BusKind = 'urban' | 'extraurban';

export interface BusVehicle {
  id: string;
  lat: number;
  lon: number;
  bearing: number;
  route: string;
  speed: number;
  kind: BusKind;
  live: boolean;      // true = real GPS position; false = on-time schedule estimate
  delay?: number;     // minutes late (real-time); negative = early
  headsign?: string;  // trip destination
}

export interface Stats {
  stations: number;
  taxi: number;
  carsharing: number;
  parking_zones: number;
  busstops?: number;
  buses_live?: number;
  trainstations?: number;
  trains_live?: number;
}

// ── Trains ──────────────────────────────────────────────────────────────────

export type TrainBrand =
  | 'frecciarossa' | 'italo' | 'eurocity' | 'intercity'
  | 'regionale_v' | 'regionale' | 'trentino' | 'valsugana';

export interface RailCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: number[][] };
    properties: { line: string; length_km: number };
  }[];
}

export interface TrainCarriage {
  lat: number;
  lon: number;
  bearing: number;
}

export interface TrainVehicle {
  id: string;
  lat: number;
  lon: number;
  bearing: number;
  carriages: TrainCarriage[];   // per-carriage positions along the track
  brand: TrainBrand;
  brandLabel: string;
  color: string;       // hex with '#'
  fast: boolean;       // high-speed service → aerodynamic nose
  cars: number;
  lengthM: number;
  number: string;      // e.g. 'FR 8519'
  headsign: string;    // destination
  line: string;        // 'brennero' | 'ftm'
  delay: number;       // minutes late
  live: boolean;       // true = real GPS fix, false = schedule estimate
  speed: number;       // km/h
}

export interface TrainDeparture {
  number: string;
  brand: string;
  brandLabel: string;
  color: string;
  destination: string;
  time: string;        // 'HH:MM'
  delay: number;       // minutes late
  platform: string;    // track / binario
  inMin: number | null;
}

export interface TrainBoard {
  code: string;
  name: string;
  line: string;
  time: string;
  date: string;
  departures: TrainDeparture[];
}

export interface Departure {
  time: string;        // 'HH:MM'
  route: string;       // short line name, e.g. '5'
  route_long: string;
  color: string;       // hex without '#'
  text_color: string;  // hex without '#'
  headsign: string;
  in_min: number;      // minutes from the reference time
}

export interface StopSchedule {
  stop_id: string;
  stop_name: string;
  time: string;        // reference time, 'HH:MM'
  date: string;        // 'YYYY-MM-DD'
  departures: Departure[];
}
