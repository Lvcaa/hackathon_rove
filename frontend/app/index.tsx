import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useMobilityData } from '../hooks/useMobilityData';
import type { SuggestionItem } from '../components/BookingSheet.web';
import { useLiveLocation } from '../hooks/useLiveLocation';
import { MobilityFeature, CategoryKey } from '../types/mobility';
import { Colors } from '../constants/colors';
import MapView from '../components/MapView';
import BottomSheet from '../components/BottomSheet';
import LayerTogglePanel from '../components/LayerTogglePanel';
import BookingSheet from '../components/BookingSheet';


const ALL: Set<CategoryKey> = new Set([
  'stations', 'taxi', 'carsharing', 'parking',
  'busstops_urban', 'busstops_extraurban', 'buses',
  'trainstations', 'trains',
]);

export default function MapScreen() {
  const { data, busStops, busVehicles, trainStations, rail, trainVehicles, stats } = useMobilityData();
  const { location, status: locationStatus, start: startLocating } = useLiveLocation();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [visibleCategories, setVisibleCategories] = useState<Set<CategoryKey>>(new Set(ALL));
  const [recenterNonce, setRecenterNonce] = useState(0);
  const [selectedFeature, setSelectedFeature] = useState<{
    feature: MobilityFeature;
    category: CategoryKey;
  } | null>(null);
  const [bookingTrigger, setBookingTrigger] = useState<{ destination: string; nonce: number } | null>(null);

  // Build flat suggestion list for the SearchBar autocomplete from all mobility features
  const suggestions = useMemo<SuggestionItem[]>(() => {
    const out: SuggestionItem[] = [
      { name: 'Stazione FS Rovereto', category: 'stations' },
      { name: 'Stazione FS Trento',   category: 'stations' },
    ];
    const pushFrom = (cat: SuggestionItem['category'], features: typeof data.stations.features) => {
      features.forEach((f) => {
        const p = f.properties;
        const name = String(p.nome || p.name || p.via || p.zona || p.descrizione || '').trim();
        if (name) out.push({ name, category: cat });
      });
    };
    pushFrom('stations',   data.stations.features);
    pushFrom('taxi',       data.taxi.features);
    pushFrom('carsharing', data.carsharing.features);
    pushFrom('parking',    data.parking.features);
    // De-duplicate by name (case-insensitive), keeping first occurrence
    const seen = new Set<string>();
    return out.filter((s) => {
      const k = s.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [data]);

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
    setBookingTrigger((prev) => ({ destination: name, nonce: (prev?.nonce ?? 0) + 1 }));
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
      <View style={styles.mapWrapper}>
        <MapView
          data={data}
          busStops={busStops}
          busVehicles={busVehicles}
          trainStations={trainStations}
          rail={rail}
          trainVehicles={trainVehicles}
          visibleCategories={visibleCategories}
          selectedFeature={selectedFeature?.feature ?? null}
          onFeatureSelect={handleFeatureSelect}
          onNavigate={handleNavigate}
          userLocation={location}
          locationStatus={locationStatus}
          recenterNonce={recenterNonce}
          onLocate={handleLocate}
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
        <BookingSheet searchTrigger={bookingTrigger} suggestions={suggestions} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: Colors.bg },
  mapWrapper: { flex: 1, position: 'relative' },
});
