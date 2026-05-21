// Native stub — booking flow is web-only in v1.
// Expo automatically resolves BookingSheet.web.tsx for web targets.

interface Props {
  onRouteReady?: (waypoints: [number, number][], dest: [number, number]) => void;
  searchTrigger?: { destination: string; nonce: number } | null;
}

export default function BookingSheet(_props: Props) {
  return null;
}
