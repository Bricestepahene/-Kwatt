/**
 * Relie la barre du bas du kit (ui/BottomTabBar) au navigateur à onglets d'expo-router.
 * Onglets : index (Accueil), jouer, ligues, cartes, profil.
 */
import type { BottomTabBarProps } from 'expo-router/tabs';
import { useTranslation } from 'react-i18next';
import { BottomTabBar, TAB_ICONS, type BottomTabItem } from '../ui/BottomTabBar';

/** Nom de la route d'onglet → clé de libellé et icône. */
export const TAB_ROUTES = {
  index: 'home',
  jouer: 'play',
  ligues: 'leagues',
  cartes: 'cards',
  profil: 'profile',
} as const;

type TabRouteName = keyof typeof TAB_ROUTES;

function isTabRoute(name: string): name is TabRouteName {
  return name in TAB_ROUTES;
}

export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const { t } = useTranslation('common');
  const items: BottomTabItem[] = [];

  state.routes.forEach((route, index) => {
    if (!isTabRoute(route.name)) return;
    const tab = TAB_ROUTES[route.name];
    const selected = state.index === index;
    items.push({
      key: route.key,
      label: t(`tabs.${tab}`),
      icon: TAB_ICONS[tab],
      selected,
      onPress: () => {
        const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (!selected && !event.defaultPrevented) navigateToTab(route.key);
      },
      onLongPress: () => {
        emitter.emit({ type: 'tabLongPress', target: route.key });
      },
    });
  });

  return <BottomTabBar items={items} accessibilityLabel={t('tabs.navigation')} />;
}
