// ── Multimodal routing — mirrors POST /api/routing/suggest ────────────────────

export type LegMode = 'walk' | 'bus' | 'train' | 'drive' | 'taxi';

export interface RoutePoint {
  name: string;
  lat: number;
  lng: number;
}

export interface RouteLeg {
  mode: LegMode;
  from: RoutePoint;
  to: RoutePoint;
  distance_m: number;
  duration_min: number;
  polyline: [number, number][];   // [lng, lat] pairs
  line_name?: string;
}

export interface RouteSuggestion {
  id: string;
  label: string;
  icon: string;
  summary: string;
  total_distance_m: number;
  total_duration_min: number;
  cost_eur: number;
  legs: RouteLeg[];
  recommended: boolean;
  cheapest: boolean;
}

export interface RouteResponse {
  origin: RoutePoint;
  destination: RoutePoint;
  straight_line_m: number;
  suggestions: RouteSuggestion[];
}

// ── Destination search — mirrors GET /api/routing/search ─────────────────────

export type PlaceCategory =
  | 'busstop' | 'station' | 'parking' | 'carsharing' | 'taxi' | 'address' | 'poi';

export interface PlaceResult {
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  detail: string;
  score: number;
}

export const PLACE_ICON: Record<PlaceCategory, string> = {
  busstop:    '🚏',
  station:    '🚉',
  parking:    '🅿️',
  carsharing: '🚗',
  taxi:       '🚕',
  address:    '📍',
  poi:        '📍',
};

// Per-mode display tokens, shared by the routing panel and the map route layer.
export const MODE_META: Record<LegMode, { color: string; icon: string; label: string }> = {
  walk:  { color: '#9ca3af', icon: '🚶', label: 'A piedi' },
  bus:   { color: '#76b82a', icon: '🚌', label: 'Bus' },
  train: { color: '#8b5cf6', icon: '🚆', label: 'Treno' },
  drive: { color: '#3b82f6', icon: '🚗', label: 'Auto' },
  taxi:  { color: '#fbbf24', icon: '🚕', label: 'Taxi' },
};

// ── AI planner — mirrors POST /api/ai/plan ───────────────────────────────────

export interface AICapabilities {
  summary: string;
  can_do: string[];
  examples: string[];
}

export interface AIIntent {
  in_scope: boolean;
  destination: string | null;
  mode: string;
  restated: string;
}

// Success body of POST /api/ai/plan.
export interface AIPlanResponse {
  intent: AIIntent;
  origin: RoutePoint;
  destination: RoutePoint & { category?: string };
  straight_line_m: number;
  suggestions: RouteSuggestion[];
  chosen_id: string;
  ai_summary: string;
  capabilities: AICapabilities;
}

// `detail` payload of a 4xx/5xx response from POST /api/ai/plan.
export interface AIPlanError {
  message: string;
  capabilities: AICapabilities;
  did_you_mean?: string[];
}
