import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFormat } from '../i18n';
import { COMPACT_FONT_SCALE, textVariants, useTheme } from '../theme';
import { CauriIcon } from './brand';
import { Badge } from './Chip';
import { Text } from './Text';

/**
 * Solde de cauris (pastille ivoire, planches Accueil et Identité) :
 * « 2 450 » ou, avec `withLabel`, « 2 450 cauris ».
 */
export function CauriBadge({
  amount,
  withLabel = false,
  size = 'md',
  style,
}: {
  amount: number;
  withLabel?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const f = useFormat();
  const text = withLabel ? f.cauris(amount) : f.caurisAmount(amount);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={f.cauris(amount)}
      style={[styles.cauri, { backgroundColor: colors.inverse, height: size === 'md' ? 36 : 32 }, style]}
    >
      <CauriIcon size={16} />
      <Text
        style={[size === 'md' ? textVariants.labelStrong : textVariants.smallStrong, { color: colors.onInverse }]}
        maxFontSizeMultiplier={COMPACT_FONT_SCALE}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

/** Échelons (SPEC §7) : Apprenti 1–4, Débrouillard 5–9, Ancien du kwatt 10–14, Notable 15–19, Chef 20–24, Fon 25+. */
export type RankId = 'apprenti' | 'debrouillard' | 'ancien' | 'notable' | 'chef' | 'fon';

/** Badge d'échelon et de niveau (« NOTABLE · NIV 17 »), en ivoire (audit : les rangs ne sont plus en or). */
export function RankBadge({ rank, level, style }: { rank: RankId; level: number; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation('common');
  const rankLabel = t(`rank.${rank}`);
  return (
    <Badge
      label={t('rank.badge', { rank: rankLabel, level })}
      accessibilityLabel={t('rank.a11y', { rank: rankLabel, level })}
      tone="inverse"
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  cauri: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 999, alignSelf: 'flex-start' },
});
