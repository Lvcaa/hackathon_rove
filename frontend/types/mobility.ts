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

export type CategoryKey = 'stations' | 'taxi' | 'carsharing' | 'parking' | 'busstops' | 'buses';

export interface MobilityData {
  stations: MobilityCollection;
  taxi: MobilityCollection;
  carsharing: MobilityCollection;
  parking: MobilityCollection;
}

export interface BusVehicle {
  id: string;
  lat: number;
  lon: number;
  bearing: number;
  route: string;
  speed: number;
}

export interface Stats {
  stations: number;
  taxi: number;
  carsharing: number;
  parking_zones: number;
  busstops?: number;
  buses_live?: number;
}
