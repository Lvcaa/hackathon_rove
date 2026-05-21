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
  | 'buses';

export interface MobilityData {
  stations: MobilityCollection;
  taxi: MobilityCollection;
  carsharing: MobilityCollection;
  parking: MobilityCollection;
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
