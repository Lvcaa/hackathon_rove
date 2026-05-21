import React, { useState, useCallback } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useMobilityData } from '../hooks/useMobilityData';
import { MobilityFeature, CategoryKey } from '../types/mobility';
import { Colors } from '../constants/colors';
import MapView from '../components/MapView';
import Sidebar from '../components/Sidebar';
import BottomSheet from '../components/BottomSheet';
import StatsCard from '../components/StatsCard';
import BookingSheet from '../components/BookingSheet';

const ALL: Set<CategoryKey> = new Set(['stations', 'taxi', 'carsharing', 'parking', 'busstops', 'buses']);

export default function MapScreen() {
  const { data, busStops, busVehicles, stats } = useMobilityData();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [visibleCategories, setVisibleCategories] = useState<Set<CategoryKey>>(new Set(ALL));
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

  const handleNavigate = useCallback((feature: MobilityFeature, category: CategoryKey) => {
    const p    = feature.properties;
    const dest = String(p.descrizione || p.zona || p.nome || p.name || p.via || category);
    setBookingTrigger((prev) => ({ destination: dest, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

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
        />
        <StatsCard stats={stats} />
        {!isDesktop && (
          <BottomSheet
            data={data}
            visibleCategories={visibleCategories}
            onToggleCategory={handleToggleCategory}
            onFeatureSelect={handleFeatureSelect}
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
