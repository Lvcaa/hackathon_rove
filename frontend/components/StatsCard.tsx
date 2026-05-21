import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';
import { Stats } from '../types/mobility';

interface Props { stats: Stats; }

const CARDS = [
  { key: 'stations' as const,      label: 'Stazioni',  icon: '🚂', color: Colors.cyan   },
  { key: 'taxi' as const,          label: 'Taxi',       icon: '🚕', color: Colors.yellow },
  { key: 'carsharing' as const,    label: 'Car share',  icon: '🚗', color: Colors.purple },
  { key: 'parking_zones' as const, label: 'Parcheggi', icon: '🅿️', color: Colors.green  },
];

export default function StatsCard({ stats }: Props) {
  return (
    <View style={styles.container}>
      {CARDS.map(({ key, label, icon, color }) => (
        <View key={key} style={styles.card}>
          <Text style={styles.icon}>{icon}</Text>
          <Text style={[styles.value, { color }]}>{stats[key]}</Text>
          <Text style={styles.label}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'column',
    gap: 6,
  },
  card: {
    backgroundColor: 'rgba(13,13,13,0.85)',
    backdropFilter: 'blur(12px)' as any,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 110,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: { fontSize: 16 },
  value: { fontSize: 20, fontWeight: '800', lineHeight: 24 },
  label: { fontSize: 10, color: Colors.textMuted, marginTop: 1, flex: 1 },
});
