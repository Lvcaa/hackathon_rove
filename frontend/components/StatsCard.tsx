import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';
import { Stats } from '../types/mobility';

interface Props {
  stats: Stats;
}

const CARDS = [
  { key: 'stations' as const, label: 'Stazioni', color: Colors.cyan },
  { key: 'taxi' as const, label: 'Taxi', color: Colors.yellow },
  { key: 'carsharing' as const, label: 'Car sharing', color: Colors.purple },
  { key: 'parking_zones' as const, label: 'Parcheggi', color: Colors.green },
];

export default function StatsCard({ stats }: Props) {
  return (
    <View style={styles.container}>
      {CARDS.map(({ key, label, color }) => (
        <View key={key} style={styles.card}>
          <Text style={styles.label}>{label}</Text>
          <Text style={[styles.value, { color }]}>{stats[key]}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 12, right: 12, gap: 6 },
  card: {
    backgroundColor: 'rgba(17,17,17,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 130,
  },
  label: {
    fontSize: 9,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: { fontSize: 22, fontWeight: '800', lineHeight: 26 },
});
