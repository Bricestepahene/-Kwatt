/**
 * Écran 29 · Championnat (planche Championnat) : bandeau (journée, code, cagnotte), ton
 * prochain match, classement (J V N D Pts, ou places et pions au Ludo) avec les zones
 * champion · podium · relégation. Avant le lancement : les inscrits, le code à partager,
 * « Rejoindre » ou « Lancer ». Le lien kwatt://ligue/CODE arrive ici ; une coupe va en 30,
 * une ligue publique encore aux inscriptions en 32.
 */
import { brand } from '@kwatt/design';
import type { LeagueDetail, StandingRowView } from '@kwatt/protocol';
import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import { translateError, useFormat } from '@/i18n';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Badge, Button, Card, Chip, ConfirmSheet, Screen, SectionLabel, Text, formatRoomCode, showToast } from '@/ui';
import { useLeague, useLeagueAction } from '../api';
import { LeagueBand, Note, QueryBody, WoodChips, useLeagueDates } from '../components';
import { leagueHref, opponentOf } from '../logic';
import { MyTeamMatchCard, TeamRegistration, TeamRoundMatches, TeamStandingsTable } from './TeamLeague';

export function zoneColor(zone: StandingRowView['zone']): string | null {
  if (zone === 'champion') return brand.orToghu;
  if (zone === 'podium') return brand.bleuWouri;
  if (zone === 'relegation') return brand.rougeToghu;
  return null;
}

/** Bandeau commun au championnat et à la coupe. */
export function LeagueHeader({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const chips: string[] = [];
  if (league.status === 'running' && league.totalRounds > 0) chips.push(t('detail.round', { round: league.currentRound, total: league.totalRounds }));
  if (league.status === 'finished') chips.push(t('detail.finished'));
  if (league.status === 'cancelled') chips.push(t('detail.cancelled'));
  chips.push(t('detail.code', { code: formatRoomCode(league.code) }));
  if (league.entry > 0) chips.push(t('detail.pot', { amount: f.caurisAmount(league.pot) }));
  return (
    <LeagueBand
      game={league.game}
      kicker={t('detail.kicker', { game: t(`game.${league.game}`), kind: league.teamSize ? t('teams.kind') : t(`detail.kind.${league.access}_${league.format}`) })}
      title={league.name}
    >
      <WoodChips items={chips} />
    </LeagueBand>
  );
}

/** Prochain match : « Toi contre Armand (1er) · Dimanche 18:00 · Jouer ». */
export function NextMatchCard({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const dates = useLeagueDates();
  const me = useSession((s) => s.data?.user.id ?? null);
  const match = league.me.nextMatch;
  if (!match) return null;
  const opponent = opponentOf(match, me);
  const position = league.standings.find((r) => r.player.userId === opponent?.userId)?.position ?? null;
  const leg = match.leg ? t(match.leg === 1 ? 'detail.leg1' : 'detail.leg2') : '';
  const title =
    match.players.length > 2
      ? t('detail.nextTable', { count: match.players.length - 1 })
      : position
        ? t('detail.versusPos', { name: opponent?.pseudo ?? '?', place: t('place', { count: position, ordinal: true }) })
        : t('detail.versus', { name: opponent?.pseudo ?? '?' });
  const open = () => router.push(`/ligue/${league.id}/match/${match.id}` as Href);
  return (
    <Card highlighted onPress={open} accessibilityLabel={`${t('detail.nextMatch', { round: match.round, leg })}. ${title}`} gap={10}>
      <View style={styles.next}>
        <View style={styles.nextTexts}>
          <Text variant="caption" tone="muted">
            {t('detail.nextMatch', { round: match.round, leg }).trim()}
          </Text>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" tone="muted">
            {t('detail.nextWhen', { when: dates.dayTime(match.matchAt) })}
          </Text>
        </View>
        <Button label={t('detail.play')} size="xs" onPress={open} />
      </View>
    </Card>
  );
}

/** Tableau du classement. */
export function StandingsTable({ league, rows }: { league: LeagueDetail; rows: readonly StandingRowView[] }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const { colors } = useTheme();
  const me = useSession((s) => s.data?.user.id ?? null);
  const ludo = league.game === 'ludo';
  const cols = ludo ? [t('table.played'), t('table.firsts'), t('table.tokens')] : [t('table.played'), t('table.wins'), t('table.draws'), t('table.losses')];
  return (
    <View accessibilityRole="list" style={[styles.table, { backgroundColor: colors.surface }]}>
      <View style={[styles.tr, styles.th, { borderBottomColor: colors.border }]}>
        <Text variant="caption" tone="muted" style={styles.pos}>
          #
        </Text>
        <Text variant="caption" tone="muted" style={styles.name}>
          {t('table.player')}
        </Text>
        {cols.map((c) => (
          <Text key={c} variant="caption" tone="muted" style={styles.num}>
            {c}
          </Text>
        ))}
        <Text variant="caption" tone="muted" style={styles.pts}>
          {t('table.points')}
        </Text>
      </View>
      {rows.map((r) => {
        const zone = r.excluded ? null : zoneColor(r.zone);
        const mine = r.player.userId === me;
        const values = ludo ? [r.played, r.wins, r.tiebreak] : [r.played, r.wins, r.draws, r.losses];
        const name = mine ? t('table.me', { name: r.player.pseudo }) : r.player.pseudo;
        return (
          <View
            key={r.player.userId}
            accessible
            accessibilityLabel={t('table.rowA11y', { place: r.position, name, points: r.points, played: r.played })}
            style={[styles.tr, mine ? { backgroundColor: colors.surfaceStrong } : null, r.excluded ? styles.excluded : null]}
          >
            <View style={styles.pos}>
              <View style={[styles.posBox, zone ? { backgroundColor: zone } : null]}>
                <Text variant="smallStrong" style={zone ? { color: brand.nuit } : null}>
                  {r.position}
                </Text>
              </View>
            </View>
            <Text variant={mine ? 'smallStrong' : 'small'} style={styles.name} numberOfLines={1}>
              {name}
              {r.excluded ? ` · ${t('table.excluded')}` : ''}
            </Text>
            {values.map((v, i) => (
              <Text key={i} variant="small" tone="muted" style={styles.num}>
                {f.number(v)}
              </Text>
            ))}
            <Text variant="smallStrong" style={styles.pts}>
              {f.number(r.points)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Legend({ relegated }: { relegated: boolean }) {
  const { t } = useTranslation('leagues');
  const items: [string, string][] = [
    [brand.orToghu, t('table.champion')],
    [brand.bleuWouri, t('table.podium')],
    ...(relegated ? ([[brand.rougeToghu, t('table.relegation')]] as [string, string][]) : []),
  ];
  return (
    <View style={styles.legend}>
      {items.map(([color, label]) => (
        <View key={label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: color }]} />
          <Text variant="caption" tone="muted">
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Avant le lancement : inscrits, code, rejoindre / quitter / lancer. */
export function Registration({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const action = useLeagueAction(league.id);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const run = (name: 'join' | 'leave' | 'start' | 'cancel') =>
    action.mutate(name, { onError: (error) => showToast(translateError(error), 'alert'), onSuccess: () => setConfirmLeave(false) });
  const share = () =>
    void Share.share({ message: t('create.shareText', { name: league.name, code: formatRoomCode(league.code), link: `kwatt://ligue/${league.code}` }) }).catch(() => undefined);
  const active = league.members.filter((m) => m.status === 'active');
  return (
    <>
      <Card gap={8}>
        <Text variant="bodyStrong">{t('registration.title', { count: active.length, max: league.maxPlaces })}</Text>
        <Text variant="small" tone="muted">
          {t('registration.body', { code: formatRoomCode(league.code) })}
        </Text>
      </Card>
      <SectionLabel>{t('registration.members')}</SectionLabel>
      <View style={styles.members}>
        {active.map((m) => (
          <Chip key={m.player.userId} label={m.player.userId === league.creator.userId ? t('registration.creator', { name: m.player.pseudo }) : m.player.pseudo} />
        ))}
      </View>
      <Button label={t('registration.share')} icon="share" variant="secondary" onPress={share} />
      {league.me.creator ? (
        <>
          <Button
            label={t('registration.start')}
            loading={action.isPending}
            disabled={active.length < 2 || action.isPending}
            onPress={() => run('start')}
          />
          <Button label={t('registration.cancel')} variant="ghost" onPress={() => run('cancel')} />
        </>
      ) : league.me.member ? (
        <Button label={t('registration.leave')} variant="outline" onPress={() => setConfirmLeave(true)} />
      ) : league.me.joinRefusal ? (
        <Note tone="alert">{t(`refusal.${league.me.joinRefusal.replace(/^league\./, '')}`, { defaultValue: t('refusal.generic') })}</Note>
      ) : (
        <Button
          label={league.entry > 0 ? t('registration.joinPaid', { amount: f.caurisAmount(league.entry) }) : t('registration.join')}
          loading={action.isPending}
          onPress={() => run('join')}
        />
      )}
      <ConfirmSheet
        visible={confirmLeave}
        title={t('registration.leaveTitle')}
        message={league.entry > 0 ? t('registration.leaveRefund', { amount: f.caurisAmount(league.entry) }) : t('registration.leaveBody')}
        confirmLabel={t('registration.leave')}
        onConfirm={() => run('leave')}
        onCancel={() => setConfirmLeave(false)}
      />
    </>
  );
}

export function Medals({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  if (league.medals.length === 0) return null;
  return (
    <Card gap={8}>
      <Text variant="subheading">{t('detail.medalsTitle')}</Text>
      {league.medals.map((m) => (
        <View key={m.player.userId} style={styles.medal}>
          <Badge label={t(`medal.${m.kind}`)} tone={m.kind === 'or' ? 'action' : 'ndop'} />
          <Text variant="bodyStrong">{m.player.pseudo}</Text>
        </View>
      ))}
    </Card>
  );
}

export function Exclusions({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  if (league.exclusions.length === 0) return null;
  return (
    <>
      {league.exclusions.map((e) => (
        <Card
          key={e.player.userId}
          onPress={() => router.push(`/ligue/${league.id}/exclusion?joueur=${e.player.userId}` as Href)}
          accessibilityLabel={t('detail.excludedLink', { name: e.player.pseudo })}
        >
          <Text variant="smallStrong" tone="alert">
            {t('detail.excludedLink', { name: e.player.pseudo })} ›
          </Text>
        </Card>
      ))}
    </>
  );
}

function Championship({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  if (league.format === 'cup') return <Redirect href={`/ligue/${league.code}/coupe` as Href} />;
  if (league.access === 'public' && (league.status === 'registration' || league.status === 'awaiting_validation')) {
    return <Redirect href={leagueHref(league) as Href} />;
  }
  if (league.teamSize) {
    return (
      <>
        <LeagueHeader league={league} />
        <View style={styles.body}>
          {league.status === 'registration' ? (
            <TeamRegistration league={league} />
          ) : (
            <>
              {league.status === 'cancelled' ? <Note tone="alert">{t('detail.cancelledBody')}</Note> : null}
              <Medals league={league} />
              <MyTeamMatchCard league={league} />
              <TeamStandingsTable league={league} />
              <Legend relegated={league.relegated > 0} />
              <TeamRoundMatches league={league} />
            </>
          )}
        </View>
      </>
    );
  }
  return (
    <>
      <LeagueHeader league={league} />
      <View style={styles.body}>
        {league.status === 'registration' ? (
          <Registration league={league} />
        ) : (
          <>
            {league.status === 'cancelled' ? <Note tone="alert">{t('detail.cancelledBody')}</Note> : null}
            <Medals league={league} />
            <NextMatchCard league={league} />
            <StandingsTable league={league} rows={league.standings} />
            <Legend relegated={league.relegated > 0} />
            <Exclusions league={league} />
          </>
        )}
      </View>
    </>
  );
}

export function ChampionshipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLeague(id);
  return (
    <Screen padded={false} gap={0} testID="screen-championnat" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <QueryBody query={query}>{(league) => <Championship league={league} />}</QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextTexts: { flex: 1, gap: 2 },
  table: { borderRadius: 14, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 10, gap: 4 },
  th: { borderBottomWidth: 1, minHeight: 34 },
  pos: { width: 30 },
  posBox: { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, minWidth: 0 },
  num: { width: 26, textAlign: 'center' },
  pts: { width: 34, textAlign: 'right' },
  excluded: { opacity: 0.5 },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  members: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  medal: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
