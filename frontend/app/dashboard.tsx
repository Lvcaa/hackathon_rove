import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useMobilityData } from '../hooks/useMobilityData';
import { Colors } from '../constants/colors';
import DashboardCard from '../components/DashboardCard';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const PARKING_REFRESH_MS = 10_000;

type ParkingZone = {
  id: string;
  name: string;
  max_capacity: number;
  available_spots: number;
  status: 'ok' | 'low' | 'full' | 'unknown';
  updated_at: string | null;
};

function useParkingLive() {
  const [zones, setZones] = useState<ParkingZone[]>([]);

  useEffect(() => {
    async function fetchZones() {
      try {
        const res = await fetch(`${API_BASE}/parking`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return;
        const data = await res.json();
        setZones(data.zones ?? []);
      } catch {
        // keep previous data
      }
    }
    fetchZones();
    const id = setInterval(fetchZones, PARKING_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  return zones;
}

function statusColor(status: ParkingZone['status']): string {
  switch (status) {
    case 'full': return '#ef4444';
    case 'low':  return '#f59e0b';
    case 'ok':   return Colors.green;
    default:     return Colors.textMuted;
  }
}

function statusLabel(status: ParkingZone['status']): string {
  switch (status) {
    case 'full':    return 'PIENO';
    case 'low':     return 'CRITICO';
    case 'ok':      return 'OK';
    default:        return 'N/D';
  }
}

function occupancyPct(zone: ParkingZone): number {
  if (zone.max_capacity === 0) return 0;
  return Math.round((1 - zone.available_spots / zone.max_capacity) * 100);
}

export default function DashboardScreen() {
  const { stats } = useMobilityData();
  const parkingZones = useParkingLive();
  const configuredZones = parkingZones.filter((z) => z.max_capacity > 0);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.title}>CommuteSync</Text>
      <Text style={styles.subtitle}>Dashboard amministratore</Text>

      <View style={styles.grid}>
        <DashboardCard
          title="Stazioni attive"
          value={stats.stations}
          color={Colors.cyan}
          subtitle="Treno / Tram"
          bars={[6, 7, 8, 8, 7, 9, stats.stations]}
        />
        <DashboardCard
          title="Taxi disponibili"
          value={stats.taxi}
          color={Colors.yellow}
          subtitle="Picco ore 08–09"
          bars={[5, 9, 7, 6, 8, 10, stats.taxi]}
        />
      </View>
      <View style={styles.grid}>
        <DashboardCard
          title="Car sharing"
          value={stats.carsharing}
          color={Colors.purple}
          subtitle="3 in uso adesso"
          bars={[2, 3, 5, 4, 3, 4, stats.carsharing]}
        />
        <DashboardCard
          title="Zone parcheggio"
          value={stats.parking_zones}
          color={Colors.green}
          subtitle="Blu, verde, viola..."
          bars={[30, 28, 34, 32, 29, 31, stats.parking_zones]}
        />
      </View>

      {configuredZones.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Occupazione parcheggi — live</Text>
          {configuredZones.map((zone) => {
            const pct = occupancyPct(zone);
            const color = statusColor(zone.status);
            return (
              <View key={zone.id} style={styles.zoneRow}>
                <View style={styles.zoneHeader}>
                  <Text style={styles.zoneName} numberOfLines={1}>{zone.name}</Text>
                  <Text style={[styles.zoneBadge, { color }]}>{statusLabel(zone.status)}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
                </View>
                <Text style={styles.zoneDetail}>
                  {zone.available_spots} / {zone.max_capacity} disponibili · {pct}% occupato
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: 20, gap: 16 },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: { fontSize: 14, color: Colors.textMuted, marginBottom: 24 },
  grid: { flexDirection: 'row', gap: 12 },
  section: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  zoneRow: { gap: 6 },
  zoneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zoneName: { flex: 1, fontSize: 14, color: Colors.textPrimary, fontWeight: '600' },
  zoneBadge: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  barTrack: {
    height: 6,
    backgroundColor: '#2a2a2a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: 3 },
  zoneDetail: { fontSize: 12, color: Colors.textMuted },
});
