/**
 * Écran 23 · Règles du jeu (planche Regles) : onglets 10×10, 8×8 et Ludo, et pour le Ludo
 * ses variantes (planche VariantesLudo : plateaux, mécanismes, combinaisons bloquées, règles
 * maison). « S'entraîner contre la machine » ouvre le défi du jeu choisi.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useDynamicT } from '@/i18n';
import { useTheme } from '@/theme';
import { Button, Card, Header, Screen, SegmentedTabs, Text } from '@/ui';
import { mechanicLines, VARIANT_TABLE } from './mechanics';

export type RulesGame = 'dames' | 'dames8' | 'ludo';
const GAMES: readonly RulesGame[] = ['dames', 'dames8', 'ludo'];
const POINTS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;
const BLOCKED = ['b1', 'b2', 'b3', 'b4', 'b5'] as const;

export function toRulesGame(value: string | string[] | undefined): RulesGame {
  const v = Array.isArray(value) ? value[0] : value;
  return (GAMES as readonly string[]).includes(v ?? '') ? (v as RulesGame) : 'ludo';
}

export function RulesScreen() {
  const { t } = useTranslation('ludo');
  const td = useDynamicT();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ jeu?: string }>();
  const game = toRulesGame(params.jeu);
  const select = (g: RulesGame) => router.setParams({ jeu: g });

  return (
    <Screen
      space={game === 'ludo' ? 'ludo' : 'dames'}
      header={<Header title={t('rules.title')} fallback={(game === 'ludo' ? '/jouer/ludo' : '/jouer/dames') as Href} />}
      gap={12}
      footer={
        <Button
          label={t('rules.train')}
          onPress={() => router.push((game === 'ludo' ? '/jouer/ludo?jouer=1' : '/dames/machine') as Href)}
        />
      }
    >
      <SegmentedTabs<RulesGame>
        accessibilityLabel={t('rules.tabsLabel')}
        value={game}
        onChange={select}
        options={GAMES.map((g) => ({ value: g, label: td(`ludo:rules.tabs.${g}`) }))}
      />
      <Text variant="small" tone="muted">
        {td(`ludo:rules.sub.${game}`)}
      </Text>
      <View style={[styles.rules, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {POINTS.map((p, i) => (
          <View key={p} style={[styles.rule, i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}>
            <View style={[styles.n, { backgroundColor: colors.inverse }]}>
              <Text variant="number" tone="onInverse" style={styles.nText}>
                {i + 1}
              </Text>
            </View>
            <Text variant="label" style={styles.ruleText}>
              <Text variant="labelStrong">{td(`ludo:rules.${game}.${p}.t`)}</Text> {td(`ludo:rules.${game}.${p}.x`)}
            </Text>
          </View>
        ))}
      </View>

      {game === 'ludo' ? (
        <>
          <Text variant="section" tone="muted" style={styles.section} accessibilityRole="header">
            {t('rules.variantsTitle')}
          </Text>
          <Text variant="small" tone="muted">
            {t('rules.variantsIntro')}
          </Text>
          {VARIANT_TABLE.map((preset) => (
            <Card key={preset} padding={14} gap={6}>
              <View style={styles.rowBetween}>
                <Text variant="subheading" style={styles.flex}>
                  {td(`ludo:board.${preset}.name`)}
                </Text>
                <Text variant="caption" tone="muted">
                  {`${t('rules.ranking')} : ${td(`ludo:rules.rankingValue.${preset}`)}`}
                </Text>
              </View>
              <Text variant="caption" tone="muted">
                {td(`ludo:board.${preset}.desc`)}
              </Text>
              {mechanicLines({ preset, house: null }).map((l) => (
                <View key={l.row} style={styles.mech}>
                  <Text variant="caption" tone="muted" style={styles.mechKey}>
                    {td(`ludo:mech.rows.${l.row}`)}
                  </Text>
                  <Text variant="caption" style={styles.mechValue}>
                    {td(`ludo:${l.valueKey}`, l.params)}
                  </Text>
                </View>
              ))}
            </Card>
          ))}
          <Text variant="section" tone="muted" style={styles.section} accessibilityRole="header">
            {t('rules.blockedTitle')}
          </Text>
          <View style={styles.list}>
            {BLOCKED.map((b) => (
              <Text key={b} variant="small" tone="muted">
                {`• ${td(`ludo:rules.blocked.${b}`)}`}
              </Text>
            ))}
          </View>
          <Text variant="section" tone="muted" style={styles.section} accessibilityRole="header">
            {t('rules.houseTitle')}
          </Text>
          <Text variant="small" tone="muted">
            {t('rules.house')}
          </Text>
          <Button variant="outline" size="sm" label={t('rules.seeVariants')} onPress={() => router.push('/ludo/variantes' as Href)} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rules: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 4 },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 11 },
  n: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  nText: { fontSize: 13, lineHeight: 16 },
  ruleText: { flex: 1 },
  section: { marginTop: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  mech: { flexDirection: 'row', gap: 10 },
  mechKey: { width: 120 },
  mechValue: { flex: 1 },
  list: { gap: 6 },
});
