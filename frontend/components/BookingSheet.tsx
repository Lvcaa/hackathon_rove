// Native stub — booking flow is web-only in v1.
// Expo automatically resolves BookingSheet.web.tsx for web targets.

import { RouteSuggestion } from '../types/routing';

interface Props {
  onRouteReady?: (waypoints: [number, number][], dest: [number, number]) => void;
  searchTrigger?: { destination: string; nonce: number } | null;
  suggestions?: { name: string; category?: 'stations' | 'taxi' | 'carsharing' | 'parking' }[];
  aiOrigin?: { lat: number; lng: number } | null;
  onRoutePreview?: (suggestion: RouteSuggestion | null) => void;
  onRouteFocusChange?: (active: boolean) => void;
  onAIRequestLocation?: () => void;
}

export default function BookingSheet(_props: Props) {
  return null;
}
