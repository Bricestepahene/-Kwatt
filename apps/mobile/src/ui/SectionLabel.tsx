import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

/** Libellé de section en capitales espacées (« TES ESPACES DE JEU », « COMPTE »). */
export function SectionLabel({ children, right, style }: { children: string; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      <Text variant="section" tone="muted" accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

/** Barre de progression (niveau, quête) : `value` de 0 à 1 ; or par défaut (« à toi »). */
export function ProgressBar({
  value,
  color,
  height = 6,
  accessibilityLabel,
  style,
}: {
  value: number;
  color?: string;
  height?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: colors.border }, style]}
    >
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color ?? colors.action }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  track: { overflow: 'hidden', flexGrow: 1 },
});
