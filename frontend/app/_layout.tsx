import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

function injectGlobalStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cs-global')) return;
  const style = document.createElement('style');
  style.id = 'cs-global';
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #0d0d0d; }
    #root, [data-reactroot], #__next { height: 100%; display: flex; flex-direction: column; }
    /* Expo-router Tabs wraps content in divs that need to fill the viewport */
    #root > div, #root > div > div, #root > div > div > div, #root > div > div > div > div, #root > div > div > div > div > div {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
    }
    ::-webkit-scrollbar { width: 4px; background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  `;
  document.head.appendChild(style);

  // Preload Leaflet CSS early so it's fully loaded by the time the map renders
  if (!document.getElementById('cs-leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'cs-leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
}

export default function RootLayout() {
  useEffect(() => { injectGlobalStyles(); }, []);

  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
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
