/**
 * Avatar (planches Accueil, Profil, Studio d'avatar) : initiale, avatar composé
 * (teint, coiffe, tenue en tissu) ou photo (déjà modérée), avec un cadre de tissu.
 */
import { avatarSkins, type FabricName } from '@kwatt/design';
import { Image } from 'expo-image';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import { fontFamilies, useTheme } from '../theme';
import { fabricFills, FabricDefs, svgId } from './fabrics/patterns';
import { initialOf } from './logic';
import { Text } from './Text';

export type AvatarSkin = 0 | 1 | 2 | 3 | 4;

/** Ce que le serveur garde de l'image de profil (photo : seulement une fois approuvée). */
export type AvatarSpec =
  | { kind: 'initial' }
  | { kind: 'composed'; skin: AvatarSkin; hat: FabricName | 'none'; outfit: FabricName }
  | { kind: 'photo'; uri: string };

export interface AvatarProps {
  /** Pseudo : initiale et étiquette accessible. */
  name: string | null | undefined;
  avatar?: AvatarSpec;
  size?: number;
  /** Cadre de tissu gagné ou acheté (ndop sur l'accueil, toghu sur le profil). */
  frame?: FabricName | null;
  /** Couleur de fond de l'initiale (couleur de siège au Ludo) ; ivoire sinon. */
  tint?: string;
  /** Contour (or : « à toi » ; couleur du joueur). */
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
  /** Décoratif (le nom est déjà écrit à côté). */
  decorative?: boolean;
}

/** Dessin de l'avatar composé, sur une grille de 168 (taille de l'aperçu du Studio). */
function ComposedFace({ spec, size }: { spec: Extract<AvatarSpec, { kind: 'composed' }>; size: number }) {
  const { colors } = useTheme();
  const base = svgId(useId(), 'av');
  const clip = `${base}-clip`;
  const outfitId = `${base}-outfit`;
  const hatId = `${base}-hat`;
  const skin = avatarSkins[spec.skin] ?? avatarSkins[2];
  return (
    <Svg width={size} height={size} viewBox="0 0 168 168">
      <Defs>
        <ClipPath id={clip}>
          <Circle cx={84} cy={84} r={84} />
        </ClipPath>
        <FabricDefs name={spec.outfit} id={outfitId} scale={0.9} />
        {spec.hat !== 'none' ? <FabricDefs name={spec.hat} id={hatId} scale={0.7} /> : null}
      </Defs>
      <G clipPath={`url(#${clip})`}>
        <Rect width={168} height={168} fill={colors.surfaceStrong} />
        {fabricFills(spec.outfit, outfitId).map((fill) => (
          <Path key={fill} d="M24 168 V144 A60 60 0 0 1 144 144 V168 Z" fill={fill} />
        ))}
        <Ellipse cx={84} cy={72} rx={24} ry={28} fill={skin} />
        <Circle cx={73} cy={69} r={3.2} fill={colors.onInverse} />
        <Circle cx={95} cy={69} r={3.2} fill={colors.onInverse} />
        <Path d="M76 84 h16 a8 8 0 0 1 -16 0 z" fill={colors.onInverse} />
        {spec.hat !== 'none'
          ? fabricFills(spec.hat, hatId).map((fill) => (
              <Path key={fill} d="M56 54 A28 28 0 0 1 112 54 V56 a6 6 0 0 1 -6 6 H62 a6 6 0 0 1 -6 -6 Z" fill={fill} />
            ))
          : null}
      </G>
    </Svg>
  );
}

/** Anneau de tissu autour de l'avatar. */
function FabricRing({ name, size }: { name: FabricName; size: number }) {
  const id = svgId(useId(), 'ring');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={size} height={size}>
        <Defs>
          <FabricDefs name={name} id={id} />
        </Defs>
        {fabricFills(name, id).map((fill) => (
          <Circle key={fill} cx={size / 2} cy={size / 2} r={size / 2} fill={fill} />
        ))}
      </Svg>
    </View>
  );
}

export function Avatar({ name, avatar = { kind: 'initial' }, size = 48, frame = null, tint, ringColor, style, decorative = false }: AvatarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  // Proportions des planches : 36 dans 48 (accueil), 68 dans 84 (profil).
  const inner = frame ? Math.round(size * 0.78) : size;
  const ring = ringColor ? Math.max(2, Math.round(size / 16)) : 0;
  const label = avatar.kind === 'photo' ? t('common:avatar.photoOf', { name: name ?? '' }) : t('common:avatar.of', { name: name ?? '' });

  let content;
  if (avatar.kind === 'photo') {
    content = (
      <Image
        source={{ uri: avatar.uri }}
        style={{ width: inner, height: inner, borderRadius: inner / 2 }}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
      />
    );
  } else if (avatar.kind === 'composed') {
    content = <ComposedFace spec={avatar} size={inner} />;
  } else {
    content = (
      <View style={[styles.center, { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: tint ?? colors.inverse }]}>
        <Text
          style={{ fontFamily: fontFamilies.display[800], fontSize: Math.round(inner * 0.42), lineHeight: Math.round(inner * 0.52), color: colors.onInverse }}
          allowFontScaling={false}
        >
          {initialOf(name)}
        </Text>
      </View>
    );
  }

  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : label}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.center,
        { width: size, height: size, borderRadius: size / 2 },
        ringColor ? { borderWidth: ring, borderColor: ringColor } : null,
        style,
      ]}
    >
      {frame ? <FabricRing name={frame} size={size} /> : null}
      <View style={[styles.center, styles.clip, { width: inner, height: inner, borderRadius: inner / 2 }]}>{content}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  clip: { overflow: 'hidden' },
});
