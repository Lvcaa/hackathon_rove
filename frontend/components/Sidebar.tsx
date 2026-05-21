import React from 'react';
import { View, TextInput, FlatList, StyleSheet } from 'react-native';
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

export default function Sidebar({
  data,
  visibleCategories,
  onToggleCategory,
  onFeatureSelect,
}: Props) {
  const items = buildList(data, visibleCategories);

  return (
    <View style={styles.sidebar}>
      <TextInput
        style={styles.search}
        placeholder="🔍  Cerca..."
        placeholderTextColor={Colors.textMuted}
      />
      <View style={styles.filterWrap}>
        <CategoryFilter visible={visibleCategories} onToggle={onToggleCategory} />
      </View>
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
  sidebar: {
    width: 240,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    padding: 12,
    gap: 10,
  },
  search: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: Colors.textPrimary,
    fontSize: 13,
  },
  filterWrap: { marginBottom: 4 },
  list: { flex: 1 },
});
