import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import { useBookings } from '../hooks/useBookings';
import { Colors } from '../constants/colors';

// ── Auth forms ───────────────────────────────────────────────────────────────

function AuthForms() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      if (tab === 'login') {
        await login(email.trim(), password);
      } else {
        if (!fullName.trim()) { setError('Full name is required'); setLoading(false); return; }
        await register(email.trim(), password, fullName.trim());
      }
    } catch (e) {
      setError(String(e).replace('Error: ', ''));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={af.container}>
      <View style={af.tabs}>
        <Pressable style={[af.tab, tab === 'login' && af.activeTab]} onPress={() => { setTab('login'); setError(null); }}>
          <Text style={[af.tabText, tab === 'login' && af.activeTabText]}>Log in</Text>
        </Pressable>
        <Pressable style={[af.tab, tab === 'register' && af.activeTab]} onPress={() => { setTab('register'); setError(null); }}>
          <Text style={[af.tabText, tab === 'register' && af.activeTabText]}>Register</Text>
        </Pressable>
      </View>

      {tab === 'register' && (
        <TextInput
          style={af.input}
          placeholder="Full name"
          placeholderTextColor="rgba(255,255,255,0.35)"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />
      )}
      <TextInput
        style={af.input}
        placeholder="Email"
        placeholderTextColor="rgba(255,255,255,0.35)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={af.input}
        placeholder="Password"
        placeholderTextColor="rgba(255,255,255,0.35)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {error && <Text style={af.error}>{error}</Text>}

      <Pressable style={[af.btn, loading && af.btnDisabled]} onPress={handleSubmit} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={af.btnText}>{tab === 'login' ? 'Log in' : 'Create account'}</Text>}
      </Pressable>
    </View>
  );
}

// ── Bookings list ────────────────────────────────────────────────────────────

function BookingsList() {
  const { bookings, loading, error, refresh } = useBookings();

  if (loading) return <ActivityIndicator color="#4f8ef7" style={{ marginTop: 24 }} />;
  if (error) return (
    <View style={bl.center}>
      <Text style={bl.errorText}>{error}</Text>
      <Pressable onPress={refresh}><Text style={bl.retry}>Retry</Text></Pressable>
    </View>
  );
  if (bookings.length === 0) return (
    <View style={bl.center}>
      <Text style={bl.empty}>No bookings yet.</Text>
      <Text style={bl.emptyHint}>Search a destination on the map and book a spot.</Text>
    </View>
  );

  return (
    <View>
      {bookings.map((b) => (
        <View key={b.booking_id} style={bl.card}>
          <View style={bl.cardRow}>
            <Text style={bl.dest}>{b.destination_name}</Text>
            <Text style={bl.status}>{b.status}</Text>
          </View>
          <Text style={bl.id}>#{b.booking_id}</Text>
          <Text style={bl.date}>{new Date(b.created_at).toLocaleString()}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Main profile screen ──────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { user, logout, loading } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#4f8ef7" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backArrow}>←</Text>
        </Pressable>
        <Text style={s.headerTitle}>Profile</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {!user ? (
          <>
            <Text style={s.sectionTitle}>Sign in to your account</Text>
            <AuthForms />
          </>
        ) : (
          <>
            {/* Account info */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Account</Text>
              <View style={s.infoCard}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>
                    {user.full_name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')}
                  </Text>
                </View>
                <View style={s.infoText}>
                  <Text style={s.infoName}>{user.full_name}</Text>
                  <Text style={s.infoEmail}>{user.email}</Text>
                </View>
              </View>
              <Pressable style={s.logoutBtn} onPress={async () => { await logout(); }}>
                <Text style={s.logoutText}>Log out</Text>
              </Pressable>
            </View>

            {/* Bookings */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>My Bookings</Text>
              <BookingsList />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const GLASS = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  borderRadius: 14,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
} as const;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg ?? '#0d0d0d' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg ?? '#0d0d0d' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: { marginRight: 12, padding: 4 },
  backArrow: { color: '#fff', fontSize: 22 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 60 },
  section: { marginBottom: 32 },
  sectionTitle: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  infoCard: { ...GLASS, flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#4f8ef7', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  avatarText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  infoText: { flex: 1 },
  infoName: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 2 },
  infoEmail: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  logoutBtn: { ...GLASS, padding: 14, alignItems: 'center' },
  logoutText: { color: '#ff6b6b', fontWeight: '600' },
});

const af = StyleSheet.create({
  container: { gap: 12 },
  tabs: { flexDirection: 'row', ...GLASS, padding: 4, marginBottom: 4 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  activeTab: { backgroundColor: 'rgba(79,142,247,0.25)' },
  tabText: { color: 'rgba(255,255,255,0.5)', fontWeight: '600', fontSize: 14 },
  activeTabText: { color: '#fff' },
  input: {
    ...GLASS,
    color: '#fff',
    padding: 14,
    fontSize: 15,
  },
  error: { color: '#ff6b6b', fontSize: 13 },
  btn: { backgroundColor: '#4f8ef7', borderRadius: 12, padding: 15, alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

const bl = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 32 },
  errorText: { color: '#ff6b6b', marginBottom: 8 },
  retry: { color: '#4f8ef7', fontWeight: '600' },
  empty: { color: 'rgba(255,255,255,0.5)', fontSize: 15, marginBottom: 6 },
  emptyHint: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center' },
  card: {
    ...GLASS,
    padding: 14,
    marginBottom: 10,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  dest: { color: '#fff', fontWeight: '600', fontSize: 15, flex: 1 },
  status: { color: '#4f8ef7', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginLeft: 8 },
  id: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginBottom: 2 },
  date: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
});
