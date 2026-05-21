import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { MobilityFeature, MobilityData, CategoryKey } from '../types/mobility';
import { Colors, CategoryColors, CategoryIcons, CategoryLabels } from '../constants/colors';
import CategoryFilter from './CategoryFilter';

interface Props {
  data: MobilityData;
  visibleCategories: Set<CategoryKey>;
  onToggleCategory: (cat: CategoryKey) => void;
  onFeatureSelect: (feature: MobilityFeature, category: CategoryKey) => void;
  selectedFeature: { feature: MobilityFeature; category: CategoryKey } | null;
}

interface ListItem {
  feature: MobilityFeature;
  category: CategoryKey;
  key: string;
}

function getDisplayName(f: MobilityFeature): string {
  const p = f.properties;
  return String(p.nome || p.name || p.via || p.zona || p.descrizione || 'Posizione');
}

function buildList(data: MobilityData, visible: Set<CategoryKey>, query: string): ListItem[] {
  const items: ListItem[] = [];
  const q = query.toLowerCase();
  const add = (cat: CategoryKey, features: MobilityFeature[]) => {
    features.forEach((f, i) => {
      const name = getDisplayName(f).toLowerCase();
      if (!q || name.includes(q)) items.push({ feature: f, category: cat, key: `${cat}-${i}` });
    });
  };
  if (visible.has('stations')) add('stations', data.stations.features);
  if (visible.has('taxi')) add('taxi', data.taxi.features);
  if (visible.has('carsharing')) add('carsharing', data.carsharing.features);
  if (visible.has('parking')) add('parking', data.parking.features);
  return items;
}

function LocationRow({ item, isSelected, onPress }: {
  item: ListItem;
  isSelected: boolean;
  onPress: () => void;
}) {
  const color = CategoryColors[item.category];
  const name = getDisplayName(item.feature);

  return (
    <TouchableOpacity
      style={[styles.row, isSelected && { backgroundColor: color + '12', borderLeftColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconBadge, { backgroundColor: color + '20', borderColor: color + '44' }]}>
        <Text style={styles.iconText}>{CategoryIcons[item.category]}</Text>
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
        <Text style={[styles.rowMeta, { color: color + 'cc' }]}>{CategoryLabels[item.category]}</Text>
      </View>
      <View style={[styles.dot, { backgroundColor: color }]} />
    </TouchableOpacity>
  );
}

export default function Sidebar({ data, visibleCategories, onToggleCategory, onFeatureSelect, selectedFeature }: Props) {
  const [query, setQuery] = useState('');
  const items = buildList(data, visibleCategories, query);

  return (
    <View style={styles.sidebar}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>CS</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.appName}>CommuteSync</Text>
          <Text style={styles.appSub}>Mobilità urbana</Text>
        </View>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca una fermata..."
          placeholderTextColor={Colors.textMuted}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {/* Filters */}
      <CategoryFilter visible={visibleCategories} onToggle={onToggleCategory} />

      {/* Divider */}
      <View style={styles.divider} />

      {/* Count label */}
      <Text style={styles.countLabel}>{items.length} risultati</Text>

      {/* List */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <LocationRow
            item={item}
            isSelected={
              selectedFeature?.feature === item.feature &&
              selectedFeature?.category === item.category
            }
            onPress={() => onFeatureSelect(item.feature, item.category)}
          />
        )}
        style={styles.list}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 260,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    display: 'flex' as any,
    flexDirection: 'column',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.cyan + '20',
    borderWidth: 1.5,
    borderColor: Colors.cyan + '60',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 12, fontWeight: '800', color: Colors.cyan },
  appName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, lineHeight: 18 },
  appSub: { fontSize: 10, color: Colors.textMuted, lineHeight: 14 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  liveText: { fontSize: 9, color: '#22c55e', fontWeight: '700', letterSpacing: 0.5 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    gap: 6,
  },
  searchIcon: { fontSize: 13 },
  searchInput: {
    flex: 1,
    paddingVertical: 9,
    color: Colors.textPrimary,
    fontSize: 13,
    outlineStyle: 'none' as any,
  },

  divider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 12, marginTop: 8 },
  countLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    paddingHorizontal: 16,
    paddingVertical: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  list: { flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconText: { fontSize: 14 },
  rowInfo: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary, lineHeight: 16 },
  rowMeta: { fontSize: 10, fontWeight: '500', lineHeight: 14, marginTop: 1 },
  dot: { width: 6, height: 6, borderRadius: 3, opacity: 0.7 },
  separator: { height: 1, backgroundColor: Colors.border, marginLeft: 58, opacity: 0.5 },
});
