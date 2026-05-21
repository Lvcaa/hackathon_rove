import React, { useState, useCallback } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useMobilityData } from '../hooks/useMobilityData';
import { useLiveLocation } from '../hooks/useLiveLocation';
import { MobilityFeature, CategoryKey } from '../types/mobility';
import { RouteSuggestion } from '../types/routing';
import { Colors } from '../constants/colors';
import MapView from '../components/MapView';
import Sidebar from '../components/Sidebar';
import BottomSheet from '../components/BottomSheet';
import LayerTogglePanel from '../components/LayerTogglePanel';
import BookingSheet from '../components/BookingSheet';
import RoutingPanel from '../components/RoutingPanel';

// Origin/destination point a routing request resolves to.
interface RouteTarget { name: string; lat: number; lng: number; }

// Resolve a map feature to a single coordinate — its point, or a polygon's
// rough centroid (average of the exterior ring).
function featureCoords(f: MobilityFeature): { lat: number; lng: number } {
  if (f.geometry.type === 'Point') {
    const c = f.geometry.coordinates as number[];
    return { lng: c[0], lat: c[1] };
  }
  const ring = (f.geometry.coordinates as number[][][])[0] ?? [];
  const n = ring.length || 1;
  return {
    lng: ring.reduce((s, c) => s + c[0], 0) / n,
    lat: ring.reduce((s, c) => s + c[1], 0) / n,
  };
}

const ALL: Set<CategoryKey> = new Set([
  'stations', 'taxi', 'carsharing', 'parking',
  'busstops_urban', 'busstops_extraurban', 'buses',
]);

export default function MapScreen() {
  const { data, busStops, busVehicles, stats } = useMobilityData();
  const { location, status: locationStatus, start: startLocating } = useLiveLocation();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [visibleCategories, setVisibleCategories] = useState<Set<CategoryKey>>(new Set(ALL));
  const [recenterNonce, setRecenterNonce] = useState(0);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [routeTarget, setRouteTarget] = useState<RouteTarget | null>(null);
  const [activeRoute, setActiveRoute] = useState<RouteSuggestion | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<{
    feature: MobilityFeature;
    category: CategoryKey;
  } | null>(null);
  const [bookingTrigger, setBookingTrigger] = useState<{ destination: string; nonce: number } | null>(null);

  const handleToggleCategory = useCallback((cat: CategoryKey) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }, []);

  const handleFeatureSelect = useCallback((feature: MobilityFeature, category: CategoryKey) => {
    setSelectedFeature({ feature, category });
  }, []);

  // "Naviga →" on a map feature opens the routing panel for that destination,
  // routing from the user's live position. Kick off geolocation if it's idle.
  const handleNavigate = useCallback((feature: MobilityFeature, category: CategoryKey) => {
    const p    = feature.properties;
    const name = String(p.descrizione || p.zona || p.nome || p.name || p.via || category);
    setRouteTarget({ name, ...featureCoords(feature) });
    setActiveRoute(null);
    setRoutingOpen(true);
    if (locationStatus === 'idle' || locationStatus === 'error') startLocating();
  }, [locationStatus, startLocating]);

  const handleOpenRouting = useCallback(() => {
    setRoutingOpen(true);
    if (locationStatus === 'idle' || locationStatus === 'error') startLocating();
  }, [locationStatus, startLocating]);

  const handleCloseRouting = useCallback(() => {
    setRoutingOpen(false);
    setRouteTarget(null);
    setActiveRoute(null);
  }, []);

  // Hand the chosen itinerary's destination off to the booking flow.
  const handleBookFromRoute = useCallback((destinationName: string) => {
    setBookingTrigger((prev) => ({ destination: destinationName, nonce: (prev?.nonce ?? 0) + 1 }));
    setRoutingOpen(false);
    setRouteTarget(null);
    setActiveRoute(null);
  }, []);

  // Locate button: start tracking on first press, otherwise re-centre the map.
  const handleLocate = useCallback(() => {
    if (locationStatus === 'tracking') {
      setRecenterNonce((n) => n + 1);
    } else {
      startLocating();
    }
  }, [locationStatus, startLocating]);

  return (
    <View style={styles.container}>
      {isDesktop && (
        <Sidebar
          data={data}
          visibleCategories={visibleCategories}
          onToggleCategory={handleToggleCategory}
          onFeatureSelect={handleFeatureSelect}
          selectedFeature={selectedFeature}
        />
      )}
      <View style={styles.mapWrapper}>
        <MapView
          data={data}
          busStops={busStops}
          busVehicles={busVehicles}
          visibleCategories={visibleCategories}
          selectedFeature={selectedFeature?.feature ?? null}
          onFeatureSelect={handleFeatureSelect}
          onNavigate={handleNavigate}
          userLocation={location}
          locationStatus={locationStatus}
          recenterNonce={recenterNonce}
          onLocate={handleLocate}
          activeRoute={activeRoute}
          onOpenRouting={handleOpenRouting}
          routingPanelOpen={routingOpen}
        />
        <LayerTogglePanel
          visible={visibleCategories}
          onToggle={handleToggleCategory}
          stats={stats}
        />
        {!isDesktop && (
          <BottomSheet
            data={data}
            visibleCategories={visibleCategories}
            onToggleCategory={handleToggleCategory}
            onFeatureSelect={handleFeatureSelect}
          />
        )}
        {routingOpen && (
          <RoutingPanel
            origin={location}
            locationStatus={locationStatus}
            target={routeTarget}
            onTargetChange={setRouteTarget}
            onEnableLocation={startLocating}
            onClose={handleCloseRouting}
            onRouteSelect={setActiveRoute}
            onBook={handleBookFromRoute}
          />
        )}
        <BookingSheet searchTrigger={bookingTrigger} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: Colors.bg },
  mapWrapper: { flex: 1, position: 'relative' },
});
