/**
 * Les cinq onglets : Accueil · Jouer · Ligues · Cartes · Profil (barre du kit).
 * Les autres écrans s'empilent par-dessus, sans barre du bas.
 */
import { Tabs } from 'expo-router/tabs';
import { TabBar } from '@/navigation/TabBar';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="jouer" />
      <Tabs.Screen name="ligues" />
      <Tabs.Screen name="cartes" />
      <Tabs.Screen name="profil" />
    </Tabs>
  );
}
