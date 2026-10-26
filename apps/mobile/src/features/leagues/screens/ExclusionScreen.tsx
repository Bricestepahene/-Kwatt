/**
 * Écran 35 · Exclusion & calendrier recalculé (planche Exclusion) : qui est exclu et pourquoi,
 * puis trois onglets : Points (résultats annulés ou gardés, ton classement avant → après),
 * Calendrier (qui se repose, matchs restants, fin) et Cauris (remboursement, amendes, pot).
 * Le joueur exclu vient de `?joueur=` (sinon la dernière exclusion de la ligue).
 */
import type { LeagueExclusionView } from '@kwatt/protocol';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useFormat } from '@/i18n';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Button, EmptyState, Screen, SegmentedTabs, Text } from '@/ui';
import { useExclusion, useLeague } from '../api';
import { LeagueBand, Note, QueryBody, StatTiles, useLeagueDates } from '../components';
import { useLeagueId } from './MatchDayScreen';

type Tab = 'points' | 'calendar' | 'money';

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant="small" style={styles.lineLabel}>
        {label}
      </Text>
      <Text variant={strong ? 'number' : 'smallStrong'}>{value}</Text>
    </View>
  );
}

function Exclusion({ view, nextMatchId }: { view: LeagueExclusionView; nextMatchId: string | null }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const { colors } = useTheme();
  const dates = useLeagueDates();
  const me = useSession((s) => s.data?.user.id ?? null);
  const [tab, setTab] = useState<Tab>('points');
  const name = view.excluded.pseudo;
  const rounds = view.forfeitRounds.map((r) => t('exclusion.roundShort', { round: r })).join(t('exclusion.and'));
  const resultText = (c: LeagueExclusionView['changes'][number]) => {
    const who = c.player.userId === me ? t('exclusion.you') : c.player.pseudo;
    return t(`exclusion.change.${c.result}`, { who, round: c.round });
  };
  const pointsText = (points: number) => (points === 0 ? t('exclusion.lossErased') : t('exclusion.points', { count: points, signed: f.signed(points) }));

  return (
    <>
      <LeagueBand game={view.league.game} kicker={t('exclusion.kicker', { name: view.league.name, round: view.round })} fallback={`/ligue/${view.league.code}` as Href} />
      <View style={styles.body}>
        <Note tone="alert">
          <View style={styles.head}>
            <Text variant="subheading" tone="alert">
              {t('exclusion.title', { name })}
            </Text>
            <Text variant="small">
              {t(view.reason === 'consecutive' ? 'exclusion.whyConsecutive' : 'exclusion.whyTotal', { rounds, count: view.remainingPlayers })}
            </Text>
          </View>
        </Note>
        <SegmentedTabs<Tab>
          accessibilityLabel={t('exclusion.tabsLabel')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'points', label: t('exclusion.tab.points') },
            { value: 'calendar', label: t('exclusion.tab.calendar') },
            { value: 'money', label: t('exclusion.tab.money') },
          ]}
        />
        {tab === 'points' ? (
          <>
            <Text variant="small" tone="muted">
              {t(view.policy === 'annulled' ? 'exclusion.annulled' : 'exclusion.kept', { name, played: view.elapsed, total: view.totalMatches })}
            </Text>
            <View style={[styles.box, { backgroundColor: colors.surface }]}>
              {view.changes.length === 0 ? (
                <Text variant="small" tone="muted">
                  {t('exclusion.noChange')}
                </Text>
              ) : (
                view.changes.map((c, i) => <Line key={`${c.player.userId}-${c.round}-${i}`} label={resultText(c)} value={pointsText(c.points)} />)
              )}
            </View>
            {view.myPosition ? (
              <View style={[styles.box, { backgroundColor: colors.surfaceStrong }]}>
                <Line
                  label={t('exclusion.myPosition')}
                  value={`${t('place', { count: view.myPosition.before, ordinal: true })} → ${t('place', { count: view.myPosition.after, ordinal: true })}`}
                  strong
                />
              </View>
            ) : null}
          </>
        ) : tab === 'calendar' ? (
          <>
            <Text variant="small" tone="muted">
              {t(view.calendar.mode === 'bye' ? 'exclusion.calendarBye' : 'exclusion.calendarRepacked', { name })}
            </Text>
            {view.calendar.rested.length > 0 ? (
              <View style={[styles.box, { backgroundColor: colors.surface }]}>
                {view.calendar.rested.slice(0, 6).map((r) => (
                  <Line key={`${r.round}-${r.player.userId}`} label={t('exclusion.rest', { round: r.round, name: r.player.userId === me ? t('exclusion.you') : r.player.pseudo })} value={t('exclusion.restValue')} />
                ))}
                {view.calendar.rested.length > 6 ? (
                  <Text variant="caption" tone="muted">
                    {t('exclusion.moreRests', { count: view.calendar.rested.length - 6 })}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <StatTiles
              items={[
                { value: f.number(view.calendar.remainingMatches), label: t('exclusion.remaining', { count: view.calendar.remainingMatches }) },
                { value: f.number(view.calendar.matchesPerRound), label: t('exclusion.perRound') },
                {
                  value: dates.day(view.calendar.endDayAfter),
                  label: t(view.calendar.endDayAfter === view.calendar.endDayBefore ? 'exclusion.endSame' : 'exclusion.endChanged'),
                },
              ]}
            />
            <Note>{t(view.calendar.mineChanged ? 'exclusion.mineChanged' : 'exclusion.mineSame', { name })}</Note>
          </>
        ) : (
          <>
            <View style={[styles.formula, { backgroundColor: colors.surfaceStrong }]}>
              <Text variant="smallStrong" align="center">
                {t('exclusion.formula', {
                  entry: f.caurisAmount(view.league.entry),
                  remaining: view.totalMatches - view.elapsed,
                  total: view.totalMatches,
                })}
              </Text>
              <Text variant="smallStrong" align="center">
                {t('exclusion.formulaResult', { amount: f.caurisAmount(view.money.refund), name })}
              </Text>
            </View>
            <View style={[styles.box, { backgroundColor: colors.surface }]}>
              <Line label={t('exclusion.refund', { name, rest: f.caurisAmount(view.money.remaining) })} value={`−${f.caurisAmount(view.money.refund)}`} />
              <Line label={t('exclusion.fines')} value={`+${f.caurisAmount(view.money.fines)}`} />
              <Line label={t('exclusion.pot')} value={`${f.caurisAmount(view.money.potBefore)} → ${f.caurisAmount(view.money.potAfter)}`} strong />
            </View>
            <Text variant="small" tone="muted">
              {t('exclusion.shareNote', { count: view.remainingPlayers })}
            </Text>
          </>
        )}
        {nextMatchId ? (
          <Button label={t('exclusion.myNext')} onPress={() => router.push(`/ligue/${view.league.id}/match/${nextMatchId}` as Href)} />
        ) : null}
      </View>
    </>
  );
}

export function ExclusionScreen() {
  const { t } = useTranslation('leagues');
  const { id, joueur } = useLocalSearchParams<{ id: string; joueur?: string }>();
  const leagueId = useLeagueId(id);
  const league = useLeague(leagueId);
  const userId = joueur ?? league.data?.exclusions[league.data.exclusions.length - 1]?.player.userId;
  const query = useExclusion(leagueId, userId);
  const none = league.data && !userId;
  return (
    <Screen padded={false} gap={0} testID="screen-exclusion">
      {none ? (
        <EmptyState icon="check" title={t('exclusion.none')} />
      ) : (
        <QueryBody query={query}>{(view) => <Exclusion view={view} nextMatchId={league.data?.me.nextMatch?.id ?? null} />}</QueryBody>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  head: { gap: 4 },
  box: { borderRadius: 14, padding: 12, gap: 10 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  lineLabel: { flex: 1 },
  formula: { borderRadius: 12, padding: 12, gap: 4 },
});
