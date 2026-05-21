import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MobilityFeature, CategoryKey } from '../types/mobility';
import { Colors, CategoryColors, CategoryIcons, CategoryLabels } from '../constants/colors';

interface Props {
  feature: MobilityFeature;
  category: CategoryKey;
  onNavigate?: () => void;
  compact?: boolean;
}

function getDisplayName(f: MobilityFeature): string {
  const p = f.properties;
  return String(p.name || p.nome || p.via || p.zona || p.descrizione || 'Posizione');
}

export default function LocationCard({ feature, category, onNavigate, compact }: Props) {
  const color = CategoryColors[category];
  const name = getDisplayName(feature);

  if (compact) {
    return (
      <View style={styles.compactRow}>
        <View style={[styles.icon, { backgroundColor: color + '33' }]}>
          <Text style={styles.iconText}>{CategoryIcons[category]}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.meta}>{CategoryLabels[category]}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardName}>
        {CategoryIcons[category]} {name}
      </Text>
      <Text style={styles.cardMeta}>{CategoryLabels[category]}</Text>
      <TouchableOpacity
        style={[
          styles.btn,
          { borderColor: color + '66', backgroundColor: color + '1A' },
        ]}
        onPress={onNavigate}
      >
        <Text style={[styles.btnText, { color }]}>Naviga →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 14 },
  info: { flex: 1 },
  name: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },
  meta: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  cardMeta: { fontSize: 11, color: Colors.textMuted, marginBottom: 12 },
  btn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  btnText: { fontSize: 13, fontWeight: '600' },
});
