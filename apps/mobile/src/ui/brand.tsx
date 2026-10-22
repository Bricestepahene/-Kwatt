/**
 * Logo (planche « Réf · Identité » : un pion de dames au centre des quatre maisons du
 * Ludo) et icône du cauri. Couleurs de marque de @kwatt/design, identiques dans les
 * deux thèmes.
 */
import { brand, cauri } from '@kwatt/design';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { fontFamilies } from '../theme';
import { Text } from './Text';

export function Logo({ size = 120, decorative = false }: { size?: number; decorative?: boolean }) {
  const { t } = useTranslation();
  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : t('common:app.logo')}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
    >
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Path d="M60 60 L116 60 A56 56 0 0 0 60 4 Z" fill={brand.vertForet} />
        <Path d="M60 60 L60 4 A56 56 0 0 0 4 60 Z" fill={brand.rougeToghu} />
        <Path d="M60 60 L4 60 A56 56 0 0 0 60 116 Z" fill={brand.bleuWouri} />
        <Path d="M60 60 L60 116 A56 56 0 0 0 116 60 Z" fill={brand.orToghu} />
        <Circle cx={60} cy={60} r={36} fill={brand.nuit} />
        <Circle cx={60} cy={60} r={31} fill={brand.raphia} />
        <Circle cx={60} cy={60} r={24} fill="none" stroke={brand.ndop} strokeWidth={3} />
        <Path d="M60 44 L76 60 L60 76 L44 60 Z" fill={brand.ndop} />
        <Path d="M60 53 L67 60 L60 67 L53 60 Z" fill={brand.orToghu} />
      </Svg>
    </View>
  );
}

/** Mot-symbole « kwatt » et devise, comme sur l'écran de bienvenue. */
export function Wordmark({ tagline = true, size = 'large' }: { tagline?: boolean; size?: 'large' | 'small' }) {
  const { t } = useTranslation();
  const large = size === 'large';
  return (
    <View style={{ alignItems: 'center', gap: large ? 10 : 4 }}>
      <Text variant="hero" style={large ? null : { fontSize: 32, lineHeight: 34, letterSpacing: -1.2 }} accessibilityRole="header">
        {t('common:app.wordmark')}
      </Text>
      {tagline ? (
        <Text variant="subheading" tone="action" style={{ fontFamily: fontFamilies.display[500], fontSize: large ? 15 : 13 }}>
          {t('common:app.tagline')}
        </Text>
      ) : null}
    </View>
  );
}

/** Coquillage cauri (14 × 16 sur les planches). */
export function CauriIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={(size * 14) / 16} height={size} viewBox="0 0 14 16" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ellipse cx={7} cy={8} rx={6} ry={7.5} fill={cauri.shell} stroke={cauri.stroke} strokeWidth={1} />
      <Path d="M7 2.5 V13.5" stroke={cauri.stroke} strokeWidth={1.6} />
    </Svg>
  );
}
