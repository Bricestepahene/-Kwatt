/**
 * En-tête sur tissu obom des écrans Dames (planches ModeDames, DefiMachine) : le bois reste
 * foncé en Nuit comme en Plein soleil, donc le texte y est toujours ivoire (raphia) et les
 * pastilles posées sur un voile nuit, couleurs de marque de @kwatt/design.
 */
import { brand } from '@kwatt/design';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { COMPACT_FONT_SCALE, textVariants, useTheme } from '../../theme';
import { Fabric, Text } from '../../ui';

export function FabricHeader({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Fabric name="obom" style={[styles.header, style]}>
      {children}
    </Fabric>
  );
}

/** Texte ivoire sur le bois. */
export function OnWood({ children, variant = 'body', style, numberOfLines }: { children: ReactNode; variant?: keyof typeof textVariants; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return (
    <Text variant={variant} style={[{ color: brand.raphia }, style]} {...(numberOfLines ? { numberOfLines } : {})}>
      {children}
    </Text>
  );
}

/** Voile nuit posé sur le bois (sélecteur, ligne de force). */
export function WoodOverlay({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <View style={[styles.overlay, { backgroundColor: colors.overlay }, style]}>{children}</View>;
}

/** Sélecteur d'espace Dames · Ludo · Raisonnement (planche ModeDames). */
export function WoodTabs<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole={Platform.OS === 'web' ? 'tablist' : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
      style={[styles.tabs, { backgroundColor: colors.overlay }]}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole={Platform.OS === 'web' ? 'tab' : 'radio'}
            accessibilityState={{ selected: on, checked: on }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.tab, { backgroundColor: on ? brand.raphia : 'transparent', opacity: pressed && !on ? 0.75 : 1 }]}
          >
            <Text
              style={[textVariants.badge, styles.tabLabel, { color: on ? brand.nuit : brand.raphia, fontSize: o.label.length > 10 ? 10 : 12 }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={COMPACT_FONT_SCALE}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pastille « NOTABLE · NIV 17 » ivoire sur le bois. */
export function WoodBadge({ label, accessibilityLabel }: { label: string; accessibilityLabel?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: brand.raphia }]} accessible accessibilityLabel={accessibilityLabel ?? label}>
      <Text style={[textVariants.badge, { color: brand.nuit }]} maxFontSizeMultiplier={COMPACT_FONT_SCALE} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, gap: 14 },
  overlay: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  tabs: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  tabLabel: { textTransform: 'none', letterSpacing: 0 },
  badge: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 },
});
