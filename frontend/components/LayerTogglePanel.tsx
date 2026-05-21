import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { CategoryKey, Stats } from '../types/mobility';
import {
  Colors, CategoryColors, CategoryIcons, CategoryLabels,
  TrainStationColor, TrainColor,
} from '../constants/colors';

interface Props {
  visible: Set<CategoryKey>;
  onToggle: (cat: CategoryKey) => void;
  stats: Stats;
}

const LAYERS: CategoryKey[] = [
  'stations',
  'taxi',
  'carsharing',
  'parking',
  'busstops_urban',
  'busstops_extraurban',
  'buses',
  'trainstations',
  'trains',
];

const STATS: { key: keyof Stats; label: string; icon: string; color: string }[] = [
  { key: 'stations',      label: 'Stazioni',     icon: '🚂', color: Colors.cyan   },
  { key: 'taxi',          label: 'Taxi',          icon: '🚕', color: Colors.yellow },
  { key: 'carsharing',    label: 'Car share',     icon: '🚗', color: Colors.purple },
  { key: 'parking_zones', label: 'Parcheggi',    icon: '🅿️', color: Colors.green  },
  { key: 'busstops',      label: 'Fermate bus',  icon: '🚌', color: Colors.orange },
  { key: 'buses_live',    label: 'Bus in corsa', icon: '🚍', color: Colors.orange },
  { key: 'trainstations', label: 'Staz. treni',  icon: '🚉', color: TrainStationColor },
  { key: 'trains_live',   label: 'Treni in corsa', icon: '🚆', color: TrainColor },
];

// Presentational animated switch — the whole row owns the press, so this
// stays a pure visual to avoid a nested-Pressable double toggle.
function Switch({ on, color }: { on: boolean; color: string }) {
  const anim = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: on ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [on, anim]);

  const backgroundColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0.14)', color],
  });
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [2, 20] });

  return (
    <Animated.View style={[styles.track, { backgroundColor }]}>
      <Animated.View style={[styles.knob, { transform: [{ translateX }] }]} />
    </Animated.View>
  );
}

export default function LayerTogglePanel({ visible, onToggle, stats }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [contentH, setContentH] = useState(0);
  const prog = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(prog, {
      toValue: expanded ? 1 : 0,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [expanded, prog]);

  const bodyHeight = prog.interpolate({ inputRange: [0, 1], outputRange: [0, contentH] });
  const chevronRotate = prog.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] });

  return (
    <View style={styles.panel}>
      <Pressable style={styles.header} onPress={() => setExpanded((e) => !e)}>
        <Text style={styles.headerIcon}>🗺️</Text>
        <Text style={styles.headerTitle}>Livelli mappa</Text>
        <Animated.Text style={[styles.chevron, { transform: [{ rotate: chevronRotate }] }]}>
          ▾
        </Animated.Text>
      </Pressable>

      <Animated.View style={[styles.bodyClip, contentH > 0 && { height: bodyHeight }]}>
        <View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && h !== contentH) setContentH(h);
          }}
        >
          <View style={styles.body}>
            {LAYERS.map((key) => {
              const on = visible.has(key);
              const color = CategoryColors[key];
              return (
                <Pressable
                  key={key}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => onToggle(key)}
                >
                  <Text style={styles.rowIcon}>{CategoryIcons[key]}</Text>
                  <Text
                    style={[styles.rowLabel, !on && styles.rowLabelOff]}
                    numberOfLines={1}
                  >
                    {CategoryLabels[key]}
                  </Text>
                  <Switch on={on} color={color} />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.statsSection}>
            <Text style={styles.statsHeading}>Risorse in rete</Text>
            <View style={styles.statsGrid}>
              {STATS.map(({ key, label, icon, color }) => (
                <View key={key} style={styles.statCell}>
                  <Text style={styles.statIcon}>{icon}</Text>
                  <View style={styles.statText}>
                    <Text style={[styles.statValue, { color }]}>{stats[key]}</Text>
                    <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 244,
    zIndex: 1000,
    backgroundColor: 'rgba(18,18,20,0.55)',
    backdropFilter: 'blur(22px) saturate(180%)' as any,
    WebkitBackdropFilter: 'blur(22px) saturate(180%)' as any,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  headerIcon: { fontSize: 14 },
  headerTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  chevron: { fontSize: 13, color: Colors.textMuted, fontWeight: '700' },

  bodyClip: { overflow: 'hidden' },
  body: {
    paddingHorizontal: 6,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  rowIcon: { fontSize: 14, width: 18, textAlign: 'center' },
  rowLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  rowLabelOff: { color: Colors.textMuted },

  track: {
    width: 40,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
  },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
  },

  statsSection: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 10,
  },
  statsHeading: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 7,
    paddingHorizontal: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statCell: {
    width: '47.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  statIcon: { fontSize: 15 },
  statText: { flex: 1 },
  statValue: { fontSize: 16, fontWeight: '800', lineHeight: 19 },
  statLabel: { fontSize: 9, color: Colors.textMuted, marginTop: 1 },
});
