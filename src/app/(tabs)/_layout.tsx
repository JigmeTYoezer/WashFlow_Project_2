import { Tabs } from 'expo-router';

export default function TabRoutes() {
  return <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
    <Tabs.Screen name="home" />
    <Tabs.Screen name="machines" />
    <Tabs.Screen name="bookings" />
    <Tabs.Screen name="activity" />
    <Tabs.Screen name="profile" />
    <Tabs.Screen name="manage" />
  </Tabs>;
}
