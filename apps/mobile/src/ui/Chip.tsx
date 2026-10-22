import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { COMPACT_FONT_SCALE, textVariants, useTheme } from '../theme';
import { Icon, type IconName } from './icons/Icon';
import { Text } from './Text';

/**
 * Filtre à choisir (« Toutes », « Tables »… sur Cartes ; raretés sur la Boutique) :
 * choisi = pastille ivoire, sinon contour discret.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  disabled,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const fg = selected ? colors.onInverse : colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        selected
          ? { backgroundColor: colors.inverse, borderColor: colors.inverse }
          : { backgroundColor: 'transparent', borderColor: colors.border },
        { opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text variant="smallStrong" style={{ color: fg }} maxFontSizeMultiplier={COMPACT_FONT_SCALE}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Étiquette d'information (« Ludo · 4 joueurs ») : aplat ndop, non cliquable. */
export function Pill({ children, icon, style }: { children: ReactNode; icon?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: colors.surfaceStrong }, style]}>
      {icon}
      <Text variant="small" style={{ fontFamily: textVariants.tab.fontFamily }}>
        {children}
      </Text>
    </View>
  );
}

/**
 * Petit badge en capitales : `inverse` (« PROFIL REQUIS », « DAMES », échelons),
 * `ndop`, `dark` (posé sur un tissu clair), `action` (« Bêta », à toi).
 */
export function Badge({
  label,
  tone = 'inverse',
  display = true,
  style,
  accessibilityLabel,
}: {
  label: string;
  tone?: 'inverse' | 'ndop' | 'dark' | 'action';
  /** Police Unbounded (badges d'échelon, de jeu) ; sinon DM Sans (« PROFIL REQUIS »). */
  display?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const palette = {
    inverse: { bg: colors.inverse, fg: colors.onInverse },
    ndop: { bg: colors.surfaceStrong, fg: colors.text },
    dark: { bg: colors.bg, fg: colors.text },
    action: { bg: colors.action, fg: colors.onAction },
  }[tone];
  return (
    <View
      style={[styles.badge, { backgroundColor: palette.bg }, style]}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
    >
      <Text
        style={[display ? textVariants.badge : [textVariants.caption, styles.badgeBody], { color: palette.fg }]}
        maxFontSizeMultiplier={COMPACT_FONT_SCALE}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pill: { minHeight: 32, paddingHorizontal: 12, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  badge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, alignSelf: 'flex-start' },
  badgeBody: { fontFamily: textVariants.smallStrong.fontFamily, fontSize: 11, lineHeight: 14, textTransform: 'uppercase', letterSpacing: 0.4 },
});
