/**
 * Avatar (planches Accueil, Profil, Studio d'avatar, Boutique) : initiale, avatar composé
 * (teint, coiffe, tenue en tissu), avatar prêt de la boutique (composition fixe sur un fond
 * de tissu) ou photo (déjà modérée), avec un cadre de tissu.
 *
 * L'avatar est une illustration : visage et contours sont dessinés à l'encre nuit
 * (`brand.nuit`) dans les deux thèmes, comme sur les planches.
 */
import { avatarSkins, brand, type FabricName } from '@kwatt/design';
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

/** Formes de coiffe (écran 10) : bonnet, foulard noué, toque haute, couronne. */
export type AvatarHatShape = 'bonnet' | 'foulard' | 'toque' | 'couronne';
export interface AvatarHatSpec {
  fabric: FabricName;
  shape: AvatarHatShape;
}

/** Ce que le serveur garde de l'image de profil (photo : seulement une fois approuvée). */
export type AvatarSpec =
  | { kind: 'initial' }
  | {
      kind: 'composed';
      skin: AvatarSkin;
      /** Un tissu seul donne un bonnet ; `'none'` ou null : tête nue. */
      hat: FabricName | 'none' | AvatarHatSpec | null;
      outfit: FabricName;
    }
  | { kind: 'preset'; skin: AvatarSkin; hat: AvatarHatSpec | null; outfit: FabricName; background: FabricName }
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
  /** Contour (or : « à toi » ; couleur du joueur ; rareté). */
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
  /** Décoratif (le nom est déjà écrit à côté). */
  decorative?: boolean;
}

/** Coiffes sur la grille de 168 (le haut de la tête est vers y = 44). */
const HAT_PATHS: Readonly<Record<AvatarHatShape, string>> = {
  bonnet: 'M56 54 A28 28 0 0 1 112 54 V56 a6 6 0 0 1 -6 6 H62 a6 6 0 0 1 -6 -6 Z',
  foulard: 'M52 63 Q48 33 84 29 Q120 33 116 63 Q100 55 84 55 Q68 55 52 63 Z M96 34 Q104 18 112 26 Q116 34 104 38 Z',
  toque: 'M58 60 V28 Q84 20 110 28 V60 Q84 53 58 60 Z',
  couronne: 'M56 60 V30 L67 42 L76 24 L84 38 L92 24 L101 42 L112 30 V60 Q84 53 56 60 Z',
};
const OUTFIT_PATH = 'M24 168 V144 A60 60 0 0 1 144 144 V168 Z';

function hatOf(hat: Extract<AvatarSpec, { kind: 'composed' | 'preset' }>['hat']): AvatarHatSpec | null {
  if (hat === null || hat === 'none') return null;
  return typeof hat === 'string' ? { fabric: hat, shape: 'bonnet' } : hat;
}

/** Dessin de l'avatar composé ou prêt, sur une grille de 168 (taille de l'aperçu du Studio). */
function ComposedFace({ spec, size }: { spec: Extract<AvatarSpec, { kind: 'composed' | 'preset' }>; size: number }) {
  const { colors } = useTheme();
  const base = svgId(useId(), 'av');
  const clip = `${base}-clip`;
  const outfitId = `${base}-outfit`;
  const hatId = `${base}-hat`;
  const bgId = `${base}-bg`;
  const skin = avatarSkins[spec.skin] ?? avatarSkins[2];
  const hat = hatOf(spec.hat);
  const background = spec.kind === 'preset' ? spec.background : null;
  const ink = brand.nuit;
  return (
    <Svg width={size} height={size} viewBox="0 0 168 168">
      <Defs>
        <ClipPath id={clip}>
          <Circle cx={84} cy={84} r={84} />
        </ClipPath>
        {background ? <FabricDefs name={background} id={bgId} scale={0.8} /> : null}
        <FabricDefs name={spec.outfit} id={outfitId} scale={0.9} />
        {hat ? <FabricDefs name={hat.fabric} id={hatId} scale={0.7} /> : null}
      </Defs>
      <G clipPath={`url(#${clip})`}>
        {background ? (
          fabricFills(background, bgId).map((fill) => <Rect key={fill} width={168} height={168} fill={fill} />)
        ) : (
          <Rect width={168} height={168} fill={colors.surfaceStrong} />
        )}
        {fabricFills(spec.outfit, outfitId).map((fill) => (
          <Path key={fill} d={OUTFIT_PATH} fill={fill} />
        ))}
        <Path d={OUTFIT_PATH} fill="none" stroke={ink} strokeWidth={2.5} />
        <Ellipse cx={84} cy={72} rx={24} ry={28} fill={skin} stroke={ink} strokeWidth={1.5} />
        <Circle cx={73} cy={69} r={3.2} fill={ink} />
        <Circle cx={95} cy={69} r={3.2} fill={ink} />
        <Path d="M76 84 h16 a8 8 0 0 1 -16 0 z" fill={ink} />
        {hat ? (
          <>
            {fabricFills(hat.fabric, hatId).map((fill) => (
              <Path key={fill} d={HAT_PATHS[hat.shape]} fill={fill} />
            ))}
            <Path d={HAT_PATHS[hat.shape]} fill="none" stroke={ink} strokeWidth={1.8} strokeLinejoin="round" />
          </>
        ) : null}
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
  const { t } = useTranslation('common');
  // Proportions des planches : 36 dans 48 (accueil), 68 dans 84 (profil).
  const ring = ringColor ? Math.max(2, Math.round(size / 16)) : 0;
  // Sans cadre, un contour laisse un petit jour entre lui et le visage.
  const inner = frame ? Math.round(size * 0.78) : ringColor ? size - 2 * (ring + 2) : size;
  const label = avatar.kind === 'photo' ? t('avatar.photoOf', { name: name ?? '' }) : t('avatar.of', { name: name ?? '' });

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
  } else if (avatar.kind === 'composed' || avatar.kind === 'preset') {
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
        style,
      ]}
    >
      {frame ? <FabricRing name={frame} size={size} /> : null}
      <View style={[styles.center, styles.clip, { width: inner, height: inner, borderRadius: inner / 2 }]}>{content}</View>
      {ringColor ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: ring, borderColor: ringColor }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  clip: { overflow: 'hidden' },
});
