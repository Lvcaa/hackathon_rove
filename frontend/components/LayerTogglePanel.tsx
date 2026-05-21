import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { CategoryKey } from '../types/mobility';
import { Colors, CategoryColors, CategoryIcons, CategoryLabels } from '../constants/colors';

interface Props {
  visible: Set<CategoryKey>;
  onToggle: (cat: CategoryKey) => void;
}

const LAYERS: CategoryKey[] = [
  'stations',
  'taxi',
  'carsharing',
  'parking',
  'busstops_urban',
  'busstops_extraurban',
  'buses',
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

export default function LayerTogglePanel({ visible, onToggle }: Props) {
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
          style={styles.body}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && h !== contentH) setContentH(h);
          }}
        >
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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 214,
    zIndex: 1000,
    backgroundColor: 'rgba(13,13,13,0.9)',
    backdropFilter: 'blur(14px)' as any,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
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
});
