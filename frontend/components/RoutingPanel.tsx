// Native stub — the routing panel is web-only in v1.
// Expo automatically resolves RoutingPanel.web.tsx for web targets.

import { LiveLocation, LocationStatus } from '../hooks/useLiveLocation';
import { RouteSuggestion } from '../types/routing';

interface Props {
  origin: LiveLocation | null;
  locationStatus: LocationStatus;
  target: { name: string; lat: number; lng: number } | null;
  onEnableLocation: () => void;
  onClose: () => void;
  onRouteSelect: (suggestion: RouteSuggestion | null) => void;
  onBook: (destinationName: string) => void;
}

export default function RoutingPanel(_props: Props) {
  return null;
}
