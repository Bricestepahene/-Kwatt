import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { COMPACT_FONT_SCALE, textVariants, useTheme } from '../theme';
import { Text } from './Text';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  accessibilityLabel?: string;
}

/**
 * Sélecteur à onglets (Dames · Ludo · Raisonnement ; Avatar · Ma photo ; Nuit · Plein soleil) :
 * pastille ivoire pour le choix courant. `overlay` : posé sur un tissu (en-tête obom).
 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  variant = 'surface',
  style,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  variant?: 'surface' | 'overlay';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const long = options.some((o) => o.label.length > 10);
  return (
    <View
      accessibilityRole={Platform.OS === 'web' ? 'tablist' : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
      style={[styles.container, { backgroundColor: variant === 'overlay' ? colors.overlay : colors.surface }, style]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const fg = selected ? colors.onInverse : variant === 'overlay' ? colors.inverse : colors.textMuted;
        return (
          <Pressable
            key={option.value}
            accessibilityRole={Platform.OS === 'web' ? 'tab' : 'radio'}
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.item,
              { backgroundColor: selected ? colors.inverse : 'transparent', opacity: pressed && !selected ? 0.75 : 1 },
            ]}
          >
            <Text
              style={[textVariants.badge, styles.label, { color: fg, fontSize: long ? 10 : 12 }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={COMPACT_FONT_SCALE}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 12 },
  item: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  label: { textTransform: 'none', letterSpacing: 0, lineHeight: 16 },
});
