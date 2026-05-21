import React from 'react';
import { Pressable, Text, View, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../hooks/useAuth';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export default function UserAvatarButton() {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push('/profile')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {user ? (
        <View style={styles.initialsCircle}>
          <Text style={styles.initialsText}>{initials(user.full_name)}</Text>
        </View>
      ) : (
        <View style={styles.iconWrap}>
          {/* Inline SVG person icon via dangerouslySetInnerHTML on web, or a unicode symbol on native */}
          {Platform.OS === 'web' ? (
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22 }}
              dangerouslySetInnerHTML={{
                __html: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
              }}
            />
          ) : (
            <Text style={styles.nativeIcon}>👤</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const GLASS = {
  backgroundColor: 'rgba(16,17,23,0.62)',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
} as const;

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    left: 10,
    bottom: 120,
    width: 44,
    height: 44,
    ...GLASS,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    // web-only blur
    ...(Platform.OS === 'web'
      ? ({ backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)' } as any)
      : {}),
  },
  pressed: { opacity: 0.7 },
  initialsCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#4f8ef7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativeIcon: { fontSize: 18 },
});
