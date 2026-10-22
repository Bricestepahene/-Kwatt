/**
 * Barre du bas (planches Accueil, Profil, Cartes) : Accueil · Jouer · Ligues · Cartes ·
 * Profil, la même partout, cachée pendant une partie. Onglet courant en or (« à toi »).
 * Composant d'affichage seul : src/navigation/TabBar le relie à expo-router.
 */
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMPACT_FONT_SCALE, textVariants, useTheme } from '../theme';
import { Icon, type IconName } from './icons/Icon';
import { Text } from './Text';

export interface BottomTabItem {
  key: string;
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** Pastille corail « à traiter ». */
  badge?: boolean;
  /** Étiquette lue (sinon `label`). */
  accessibilityLabel?: string;
}

/** Icônes des cinq onglets, reprises des planches. */
export const TAB_ICONS = {
  home: 'home',
  play: 'play',
  leagues: 'trophy',
  cards: 'cards',
  profile: 'profile',
} as const satisfies Record<string, IconName>;

export function BottomTabBar({ items, accessibilityLabel }: { items: readonly BottomTabItem[]; accessibilityLabel: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole={Platform.OS === 'web' ? 'navigation' : 'tablist'}
      accessibilityLabel={accessibilityLabel}
      style={[styles.bar, { backgroundColor: colors.tabBar, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 14) }]}
    >
      {items.map((item) => {
        const color = item.selected ? colors.action : colors.textMuted;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityState={{ selected: item.selected }}
            onPress={item.onPress}
            onLongPress={item.onLongPress}
            style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.75 : 1 }]}
          >
            <View>
              <Icon name={item.icon} size={22} color={color} />
              {item.badge ? <View style={[styles.badge, { backgroundColor: colors.alert, borderColor: colors.tabBar }]} /> : null}
            </View>
            <Text style={[textVariants.tab, { color }]} numberOfLines={1} maxFontSizeMultiplier={COMPACT_FONT_SCALE}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 8, paddingHorizontal: 6 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 48, paddingVertical: 4 },
  badge: { position: 'absolute', top: -2, right: -4, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
