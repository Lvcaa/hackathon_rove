import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '../constants/colors';

export default function RootLayout() {
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
          },
          tabBarActiveTintColor: Colors.cyan,
          tabBarInactiveTintColor: Colors.textMuted,
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
