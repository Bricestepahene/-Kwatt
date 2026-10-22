import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Fabric, type FabricName } from './fabrics';

export interface CardProps {
  children?: ReactNode;
  /** Bande de tissu en haut de la carte (salon trouvé : kaba ; profil : bois…). */
  band?: FabricName;
  bandHeight?: number;
  /** Bordure fine (cartes de la planche Sommaire) ; `dashed` : espace « bientôt ». */
  border?: 'none' | 'solid' | 'dashed';
  /** Contour or (« agis maintenant » : problème du jour non résolu). */
  highlighted?: boolean;
  padding?: number;
  radius?: number;
  gap?: number;
  tone?: 'surface' | 'strong' | 'bg';
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Carte des planches : surface #20265A, rayon 14 à 20, bande de tissu facultative. */
export function Card({
  children,
  band,
  bandHeight = 10,
  border = 'none',
  highlighted = false,
  padding = 16,
  radius = 18,
  gap = 12,
  tone = 'surface',
  onPress,
  accessibilityLabel,
  style,
  testID,
}: CardProps) {
  const { colors } = useTheme();
  const bg = tone === 'strong' ? colors.surfaceStrong : tone === 'bg' ? colors.bg : colors.surface;
  const borderStyle: ViewStyle = highlighted
    ? { borderWidth: 1, borderColor: colors.action }
    : border === 'none'
      ? {}
      : { borderWidth: 1, borderColor: border === 'dashed' ? colors.textMuted : colors.border, borderStyle: border };

  const body = (
    <>
      {band ? <Fabric name={band} style={{ height: bandHeight }} /> : null}
      <View style={{ padding, gap }}>{children}</View>
    </>
  );
  const containerStyle = [styles.card, { backgroundColor: bg, borderRadius: radius }, borderStyle, style];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [containerStyle, pressed ? styles.pressed : null]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View style={containerStyle} testID={testID}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  pressed: { opacity: 0.85 },
});
