// Native stub — the AI planner panel is web-only in v1.
// Expo automatically resolves AIPlannerPanel.web.tsx for web targets.

import { RouteSuggestion } from '../types/routing';

interface Origin { lat: number; lng: number; }

interface Props {
  origin: Origin | null;
  onPlanReady: (suggestion: RouteSuggestion) => void;
  onClear: () => void;
  onRequestLocation?: () => void;
}

export default function AIPlannerPanel(_props: Props) {
  return null;
}
