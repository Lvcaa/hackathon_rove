import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '../constants/colors';

function injectGlobalStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cs-global')) return;
  const style = document.createElement('style');
  style.id = 'cs-global';
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; background: #0d0d0d; }
    #root { height: 100%; display: flex; flex-direction: column; }
    ::-webkit-scrollbar { width: 4px; background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  `;
  document.head.appendChild(style);
}

export default function RootLayout() {
  useEffect(() => { injectGlobalStyles(); }, []);

  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderTopColor: Colors.border,
            borderTopWidth: 1,
            height: 52,
          },
          tabBarActiveTintColor: Colors.cyan,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: 'Mappa', tabBarIcon: () => null }}
        />
        <Tabs.Screen
          name="dashboard"
          options={{ title: 'Dashboard', tabBarIcon: () => null }}
        />
      </Tabs>
    </>
  );
}
