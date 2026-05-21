import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { MobilityFeature, MobilityData, CategoryKey } from '../types/mobility';
import { Colors } from '../constants/colors';
import CategoryFilter from './CategoryFilter';
import LocationCard from './LocationCard';

interface Props {
  data: MobilityData;
  visibleCategories: Set<CategoryKey>;
  onToggleCategory: (cat: CategoryKey) => void;
  onFeatureSelect: (feature: MobilityFeature, category: CategoryKey) => void;
}

interface ListItem {
  feature: MobilityFeature;
  category: CategoryKey;
}

function buildList(data: MobilityData, visible: Set<CategoryKey>): ListItem[] {
  const items: ListItem[] = [];
  if (visible.has('stations'))
    data.stations.features.forEach((f) => items.push({ feature: f, category: 'stations' }));
  if (visible.has('taxi'))
    data.taxi.features.forEach((f) => items.push({ feature: f, category: 'taxi' }));
  if (visible.has('carsharing'))
    data.carsharing.features.forEach((f) =>
      items.push({ feature: f, category: 'carsharing' })
    );
  if (visible.has('parking'))
    data.parking.features.forEach((f) => items.push({ feature: f, category: 'parking' }));
  return items;
}

export default function BottomSheet({
  data,
  visibleCategories,
  onToggleCategory,
  onFeatureSelect,
}: Props) {
  const items = buildList(data, visibleCategories);

  return (
    <View style={styles.sheet}>
      <View style={styles.handle} />
      <CategoryFilter visible={visibleCategories} onToggle={onToggleCategory} />
      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <LocationCard
            feature={item.feature}
            category={item.category}
            compact
            onNavigate={() => onFeatureSelect(item.feature, item.category)}
          />
        )}
        style={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 20,
    maxHeight: '45%',
    gap: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 6,
  },
  list: { flex: 1 },
});
