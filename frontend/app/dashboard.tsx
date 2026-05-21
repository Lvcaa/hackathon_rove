import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useMobilityData } from '../hooks/useMobilityData';
import { Colors } from '../constants/colors';
import DashboardCard from '../components/DashboardCard';

export default function DashboardScreen() {
  const { stats } = useMobilityData();

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
});
