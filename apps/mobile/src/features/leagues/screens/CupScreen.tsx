/**
 * Écran 30 · Coupe (planche Coupe) : poules (qualifiés marqués), puis la phase finale en
 * aller-retour, la finale sur toghu, ton prochain match et la règle de la manche décisive.
 */
import type { KnockoutTie, LeagueDetail, LeagueGroup } from '@kwatt/protocol';
import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useFormat } from '@/i18n';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Button, Card, Fabric, Screen, SectionLabel, Text } from '@/ui';
import { useLeague } from '../api';
import { Note, QueryBody, useLeagueDates } from '../components';
import { groupLetter, knockoutStageKey, opponentOf } from '../logic';
import { Exclusions, LeagueHeader, Medals, Registration } from './ChampionshipScreen';

function GroupCard({ group }: { group: LeagueGroup }) {
  const { t } = useTranslation('leagues');
  const { colors } = useTheme();
  const me = useSession((s) => s.data?.user.id ?? null);
  return (
    <View style={[styles.group, { backgroundColor: colors.surface }]}>
      <Text variant="subheading">{t('cup.group', { letter: groupLetter(group.index) })}</Text>
      {group.rows.map((r) => {
        const q = group.qualifiers.includes(r.player.userId);
        const mine = r.player.userId === me;
        return (
          <View
            key={r.player.userId}
            style={styles.groupRow}
            accessible
            accessibilityLabel={t('cup.rowA11y', { name: r.player.pseudo, points: r.points, context: q ? 'qualified' : undefined })}
          >
            <View style={[styles.dot, { backgroundColor: q ? colors.gain : colors.border }]} />
            <Text variant={q || mine ? 'smallStrong' : 'small'} style={styles.groupName} numberOfLines={1}>
              {mine ? t('cup.me') : r.player.pseudo}
            </Text>
            <Text variant={q ? 'smallStrong' : 'small'} tone={q ? 'default' : 'muted'}>
              {r.points}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function TieCard({ tie, final }: { tie: KnockoutTie; final: boolean }) {
  const { t } = useTranslation('leagues');
  const { colors } = useTheme();
  const dates = useLeagueDates();
  const me = useSession((s) => s.data?.user.id ?? null);
  const label = final ? t('cup.final') : t(`cup.stage.${knockoutStageKey(tie.tiesAtLevel)}`, { n: tie.tie + 1 });
  const line = (player: KnockoutTie['first'], seed: string | null, score: number) => {
    const won = tie.winner === player.userId;
    const name = player.userId === me ? t('cup.me') : player.pseudo;
    return (
      <View style={styles.tieLine}>
        <Text variant={won ? 'smallStrong' : 'small'} style={styles.groupName} numberOfLines={1}>
          {seed ? `${name} (${seed})` : name}
        </Text>
        <Text variant={won ? 'smallStrong' : 'small'}>{score}</Text>
      </View>
    );
  };
  const nextLeg = tie.matches.find((m) => m.status === 'scheduled' || m.status === 'playing');
  const body = (
    <View style={styles.tieBody}>
      <Text variant="caption" tone="muted">
        {label} · {t('cup.twoLegs')}
      </Text>
      <View style={[styles.tieBox, { backgroundColor: colors.bg }]}>
        {line(tie.first, tie.firstSeed, tie.firstScore)}
        {line(tie.second, tie.secondSeed, tie.secondScore)}
      </View>
      {nextLeg && final ? (
        <Text variant="caption" tone="muted">
          {dates.dayTime(nextLeg.matchAt)}
        </Text>
      ) : null}
    </View>
  );
  return final ? (
    <Fabric name="toghu" style={styles.final}>
      <View style={[styles.finalInner, { backgroundColor: colors.bg }]}>{body}</View>
    </Fabric>
  ) : (
    <View style={[styles.tie, { backgroundColor: colors.surface }]}>{body}</View>
  );
}

function Cup({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const me = useSession((s) => s.data?.user.id ?? null);
  if (league.format !== 'cup') return <Redirect href={`/ligue/${league.code}` as Href} />;
  const next = league.me.nextMatch;
  const opponent = next ? opponentOf(next, me) : null;
  const myTie = league.knockout.find((k) => k.matches.some((m) => m.id === next?.id));
  const levels = [...new Set(league.knockout.map((k) => k.level))].sort((a, b) => a - b);
  return (
    <>
      <LeagueHeader league={league} />
      <View style={styles.body}>
        {league.status === 'registration' ? (
          <Registration league={league} />
        ) : (
          <>
            <Medals league={league} />
            <View style={styles.groups}>
              {league.groupTables.map((g) => (
                <GroupCard key={g.index} group={g} />
              ))}
            </View>
            <View style={styles.legend}>
              <Text variant="caption" tone="muted">
                {t('cup.qualifiedLegend', { count: league.qualifiersPerGroup ?? 1 })}
              </Text>
            </View>
            {levels.length > 0 ? <SectionLabel>{t('cup.knockout')}</SectionLabel> : null}
            {levels.map((level) => {
              const ties = league.knockout.filter((k) => k.level === level);
              const final = ties.length === 1 && ties[0]!.tiesAtLevel === 1;
              return (
                <View key={level} style={styles.level}>
                  {ties.map((tie) => (
                    <TieCard key={tie.tie} tie={tie} final={final} />
                  ))}
                </View>
              );
            })}
            {next && opponent ? (
              <Button
                label={t(next.stage === 'decider' ? 'cup.playDecider' : next.leg === 2 ? 'cup.playSecond' : 'cup.playFirst', { name: opponent.pseudo })}
                onPress={() => router.push(`/ligue/${league.id}/match/${next.id}` as Href)}
              />
            ) : null}
            {myTie?.deciderNeeded || league.knockout.length > 0 ? <Note>{t('cup.deciderRule')}</Note> : null}
            {league.entry > 0 && league.status === 'running' ? (
              <Card>
                <Text variant="small" tone="muted">
                  {t('cup.potNote', { amount: f.caurisAmount(league.pot) })}
                </Text>
              </Card>
            ) : null}
            <Exclusions league={league} />
          </>
        )}
      </View>
    </>
  );
}

export function CupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLeague(id);
  return (
    <Screen padded={false} gap={0} testID="screen-coupe" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <QueryBody query={query}>{(league) => <Cup league={league} />}</QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  groups: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  group: { flexGrow: 1, flexBasis: 150, borderRadius: 14, padding: 12, gap: 6 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  groupName: { flex: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  level: { gap: 10 },
  tie: { borderRadius: 14, padding: 12 },
  tieBody: { gap: 6 },
  tieBox: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 4 },
  tieLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  final: { borderRadius: 14, padding: 8, overflow: 'hidden' },
  finalInner: { borderRadius: 10, padding: 10 },
});
