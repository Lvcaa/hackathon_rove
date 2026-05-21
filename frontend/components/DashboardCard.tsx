import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  title: string;
  value: number;
  color: string;
  subtitle?: string;
  bars?: number[];
}

export default function DashboardCard({
  title,
  value,
  color,
  subtitle,
  bars = [],
}: Props) {
  const max = Math.max(...bars, 1);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={[styles.value, { color }]}>{value}</Text>
      {subtitle && <Text style={styles.sub}>{subtitle}</Text>}
      {bars.length > 0 && (
        <View style={styles.chart}>
          {bars.map((b, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  // Use a fixed chart height of 40px; scale each bar proportionally
                  height: Math.max(2, Math.round((b / max) * 40)),
                  backgroundColor:
                    i === bars.indexOf(Math.max(...bars)) ? color : color + '44',
                },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 16,
    minHeight: 140,
  },
  title: {
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  value: { fontSize: 32, fontWeight: '800', lineHeight: 36 },
  sub: { fontSize: 11, color: Colors.textMuted, marginTop: 4 },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 40,
    marginTop: 12,
  },
  bar: { flex: 1, borderRadius: 3 },
});
