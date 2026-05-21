import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { CategoryKey } from '../types/mobility';
import { Colors, CategoryColors, CategoryIcons, CategoryLabels } from '../constants/colors';

interface Props {
  visible: Set<CategoryKey>;
  onToggle: (cat: CategoryKey) => void;
}

const CATEGORIES: CategoryKey[] = ['stations', 'taxi', 'carsharing', 'parking', 'busstops', 'buses'];

export default function CategoryFilter({ visible, onToggle }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {CATEGORIES.map((cat) => {
        const active = visible.has(cat);
        const color = CategoryColors[cat];
        return (
          <TouchableOpacity
            key={cat}
            style={[
              styles.chip,
              active && { backgroundColor: color + '22', borderColor: color },
            ]}
            onPress={() => onToggle(cat)}
          >
            <Text style={[styles.chipText, active && { color }]}>
              {CategoryIcons[cat]} {CategoryLabels[cat]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { flexDirection: 'row', gap: 6, paddingHorizontal: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },
});
