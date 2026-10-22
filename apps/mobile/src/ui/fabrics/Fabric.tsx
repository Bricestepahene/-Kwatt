import { useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import Svg, { Defs, Rect } from 'react-native-svg';
import type { Space } from '../../navigation/routes';
import { fabricFills, FabricDefs, svgId, type FabricName } from './patterns';

export interface FabricProps extends Omit<ViewProps, 'style'> {
  name: FabricName;
  style?: StyleProp<ViewStyle>;
  /** Agrandit le motif (1 = taille des planches). */
  scale?: number;
  children?: ReactNode;
}

/** Aplat de tissu (fond, en-tête, carte) ; les enfants se posent par-dessus. */
export function Fabric({ name, style, scale = 1, children, ...rest }: FabricProps) {
  const id = svgId(useId(), `fab-${name}-`);
  return (
    <View {...rest} style={[styles.base, style]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%">
          <Defs>
            <FabricDefs name={name} id={id} scale={scale} />
          </Defs>
          {fabricFills(name, id).map((fill) => (
            <Rect key={fill} x={0} y={0} width="100%" height="100%" fill={fill} />
          ))}
        </Svg>
      </View>
      {children}
    </View>
  );
}

/** Tissu de chaque espace : bois (obom) pour les Dames, kaba pour le Ludo, ndop pour le hub. */
export const SPACE_FABRIC: Readonly<Record<Space, FabricName>> = { hub: 'ndop', dames: 'obom', ludo: 'kaba' };

/**
 * Bande de tissu en haut d'un écran : repère permanent de l'espace de jeu
 * (planche « Parcours » : « la bande de tissu en haut de chaque écran indique l'espace »).
 */
export function GameBand({ space, height = 8, style }: { space: Space; height?: number; style?: StyleProp<ViewStyle> }) {
  return <Fabric name={SPACE_FABRIC[space]} style={[{ height }, style]} />;
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
});
