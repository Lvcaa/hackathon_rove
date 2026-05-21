import React, { useState, useCallback } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useMobilityData } from '../hooks/useMobilityData';
import { MobilityFeature, CategoryKey } from '../types/mobility';
import { Colors } from '../constants/colors';
import MapView from '../components/MapView';
import Sidebar from '../components/Sidebar';
import BottomSheet from '../components/BottomSheet';
import StatsCard from '../components/StatsCard';

const ALL_CATEGORIES = new Set<CategoryKey>(['stations', 'taxi', 'carsharing', 'parking']);

export default function MapScreen() {
  const { data, stats, loading } = useMobilityData();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [visibleCategories, setVisibleCategories] = useState<Set<CategoryKey>>(
    new Set(ALL_CATEGORIES)
  );
  const [selectedFeature, setSelectedFeature] = useState<{
    feature: MobilityFeature;
    category: CategoryKey;
  } | null>(null);

  const handleToggleCategory = useCallback((cat: CategoryKey) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }, []);

  const handleFeatureSelect = useCallback(
    (feature: MobilityFeature, category: CategoryKey) => {
      setSelectedFeature({ feature, category });
    },
    []
  );

  return (
    <View style={styles.container}>
      {isDesktop && (
        <Sidebar
          data={data}
          visibleCategories={visibleCategories}
          onToggleCategory={handleToggleCategory}
          onFeatureSelect={handleFeatureSelect}
        />
      )}
      <View style={styles.mapWrapper}>
        <MapView
          data={data}
          visibleCategories={visibleCategories}
          selectedFeature={selectedFeature?.feature ?? null}
          onFeatureSelect={handleFeatureSelect}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: Colors.bg },
  mapWrapper: { flex: 1, position: 'relative' },
});
