/**
 * Écran 34 · Match du jour & forfait (planche MatchDuJour) : fin de la journée, le duel (place
 * et forfaits de chacun), la planche (→ 34b), l'heure à fixer d'un commun accord, le rappel
 * des règles (10 minutes, amende, deux forfaits de suite) et « Je suis là · entrer dans la salle ».
 */
import { FORFEIT_GRACE_MS } from '@kwatt/domain';
import type { LeagueMatchView } from '@kwatt/protocol';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { translateError, useFormat } from '@/i18n';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Button, Screen, SectionLabel, Text, showToast } from '@/ui';
import { OnWood } from '../../dames/FabricHeader';
import { useLeague, useLeagueMatch, useMatchAction } from '../api';
import { LeagueBand, PlayerAvatar, QueryBody, Row, RowGroup, useLeagueDates } from '../components';
import { hoursMinutes, isUuid } from '../logic';

/** Identifiant de la ligue : l'URL peut porter le code d'invitation. */
export function useLeagueId(idOrCode: string | undefined): string | undefined {
  const byCode = useLeague(idOrCode && !isUuid(idOrCode) ? idOrCode : undefined);
  return idOrCode && isUuid(idOrCode) ? idOrCode : byCode.data?.id;
}

/** Heure qui avance (une fois par minute). */
export function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

export function boardLine(view: LeagueMatchView, t: TFunction<'leagues'>, me: string | null): string {
  const board = view.match.board ?? view.boardChoices[me ?? ''] ?? view.boardRules.defaultBoard;
  const opponent = view.players.find((p) => p.player.userId !== me)?.player.pseudo ?? '';
  return t('match.boardValue', { board: t(`board.${board}`), who: t(`match.chooser.${view.boardChooser}`, { name: opponent }) });
}

function TimeStatus({ view, me }: { view: LeagueMatchView; me: string | null }) {
  const { t } = useTranslation('leagues');
  const dates = useLeagueDates();
  const opponent = view.players.find((p) => p.player.userId !== me)?.player;
  const mine = view.timeProposals[me ?? ''] ?? null;
  const theirs = opponent ? (view.timeProposals[opponent.userId] ?? null) : null;
  const time = dates.time(view.match.matchAt);
  let text: string;
  if (view.match.timeAgreed) text = t('match.timeAgreed', { name: opponent?.pseudo ?? '', time });
  else if (mine) text = t('match.timeMine', { time: mine, name: opponent?.pseudo ?? '', default: view.defaultTime });
  else if (theirs) text = t('match.timeTheirs', { time: theirs, name: opponent?.pseudo ?? '' });
  else text = t('match.timeNone', { default: view.defaultTime });
  return (
    <Text variant="small" tone="muted" accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

function MatchDay({ view }: { view: LeagueMatchView }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const { colors } = useTheme();
  const dates = useLeagueDates();
  const me = useSession((s) => s.data?.user.id ?? null);
  const now = useNow();
  const act = useMatchAction(view.league.id, view.match.id);
  const ends = hoursMinutes(Date.parse(view.dayEndsAt) - now);
  const duel = view.players.length === 2;
  const opponent = view.players.find((p) => p.player.userId !== me);
  const roomOpen = now >= Date.parse(view.roomOpensAt);
  const arrived = Boolean(view.arrivals[me ?? '']);
  const over = view.match.status !== 'scheduled' && view.match.status !== 'playing';
  const onError = (error: unknown) => showToast(translateError(error), 'alert');
  const proposal = view.timeProposals[me ?? ''] ?? (view.match.timeAgreed ? dates.time(view.match.matchAt) : null);

  const enter = () => {
    if (view.match.gameId) {
      router.push(`/${view.league.game}/partie/${view.match.gameId}` as Href);
      return;
    }
    act.mutate(
      { kind: 'arrive' },
      {
        onSuccess: (next) => {
          if (next.match.gameId) router.push(`/${next.league.game}/partie/${next.match.gameId}` as Href);
          else showToast(t('match.waiting'), 'success');
        },
        onError,
      },
    );
  };

  return (
    <>
      <LeagueBand game={view.league.game} kicker={t('match.kicker', { name: view.league.name, round: view.match.round })} fallback={`/ligue/${view.league.code}` as Href}>
        <OnWood variant="small">{t('match.endsIn', { hours: ends.hours, minutes: String(ends.minutes).padStart(2, '0') })}</OnWood>
        <View style={[styles.duel, { backgroundColor: colors.overlay }]}>
          {view.players.map((p, i) => (
            <View key={p.player.userId} style={styles.duelSide}>
              {duel && i === 1 ? (
                <OnWood variant="subheading" style={styles.vs}>
                  {t('match.vs')}
                </OnWood>
              ) : null}
              <View style={styles.player}>
                <PlayerAvatar player={p.player} size={duel ? 48 : 36} />
                <OnWood variant="smallStrong" numberOfLines={1}>
                  {p.player.userId === me ? t('match.me') : p.player.pseudo}
                </OnWood>
                <OnWood variant="caption" numberOfLines={2} style={styles.center}>
                  {[
                    p.position ? t('place', { count: p.position, ordinal: true }) : null,
                    p.forfeitedLastRound ? t('match.forfeitYesterday', { round: view.match.round - 1 }) : t('match.forfeits', { count: p.forfeits }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </OnWood>
              </View>
            </View>
          ))}
        </View>
      </LeagueBand>
      <View style={styles.body}>
        <RowGroup>
          <Row
            label={t('match.board')}
            value={boardLine(view, t, me)}
            last
            {...(view.boardRules.policy !== 'imposed' || view.match.board === null
              ? { onPress: () => router.push(`/ligue/${view.league.id}/match/${view.match.id}/planche` as Href) }
              : {})}
          />
        </RowGroup>
        {duel && !over ? (
          <>
            <SectionLabel>{t('match.setTime')}</SectionLabel>
            <View style={styles.slots} accessibilityRole="radiogroup" accessibilityLabel={t('match.setTime')}>
              {view.slots.map((slot) => {
                const on = proposal === slot;
                return (
                  <Pressable
                    key={slot}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on, disabled: !view.timeEditable }}
                    disabled={!view.timeEditable || act.isPending}
                    onPress={() => act.mutate({ kind: 'time', time: slot }, { onError })}
                    style={({ pressed }) => [
                      styles.slot,
                      { backgroundColor: colors.surface, borderColor: on ? colors.text : colors.border, borderWidth: on ? 2 : 1, opacity: !view.timeEditable ? 0.5 : pressed ? 0.85 : 1 },
                    ]}
                  >
                    <Text variant="button">{slot}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TimeStatus view={view} me={me} />
          </>
        ) : null}
        <SectionLabel>{t('match.rulesTitle')}</SectionLabel>
        <View style={[styles.rules, { backgroundColor: colors.surface }]}>
          {[
            ['10′', t('match.ruleLate', { minutes: FORFEIT_GRACE_MS / 60_000 })],
            ...(view.fine > 0 ? [[`−${f.caurisAmount(view.fine)}`, t('match.ruleFine', { amount: f.caurisAmount(view.fine) })]] : []),
            ...(opponent?.forfeitedLastRound && duel
              ? [['×2', t('match.ruleSecond', { name: opponent.player.pseudo })]]
              : [['×2', t('match.ruleExclusion')]]),
          ].map(([badge, text]) => (
            <View key={badge} style={styles.rule}>
              <Text variant="subheading" style={styles.ruleBadge}>
                {badge}
              </Text>
              <Text variant="small" style={styles.ruleText}>
                {text}
              </Text>
            </View>
          ))}
        </View>
        {over ? (
          <Button label={t('match.backToLeague')} variant="secondary" onPress={() => router.replace(`/ligue/${view.league.code}` as Href)} />
        ) : (
          <View style={styles.enter}>
            <Button
              label={view.match.gameId ? t('match.play') : arrived ? t('match.arrived') : t('match.enter')}
              icon="play"
              loading={act.isPending && act.variables?.kind === 'arrive'}
              disabled={!roomOpen || (arrived && !view.match.gameId)}
              onPress={enter}
            />
            <Text variant="caption" tone="muted" align="center">
              {roomOpen
                ? t('match.reminders')
                : t('match.opensAt', { time: dates.time(view.roomOpensAt), day: dates.day(view.match.day) })}
            </Text>
          </View>
        )}
      </View>
    </>
  );
}

export function MatchDayScreen() {
  const { id, matchId } = useLocalSearchParams<{ id: string; matchId: string }>();
  const leagueId = useLeagueId(id);
  const query = useLeagueMatch(leagueId, matchId);
  return (
    <Screen padded={false} gap={0} testID="screen-match-du-jour" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <QueryBody query={query}>{(view) => <MatchDay view={view} />}</QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  duel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderRadius: 14, padding: 12, gap: 8 },
  duelSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  player: { flex: 1, alignItems: 'center', gap: 4 },
  vs: { marginRight: 4 },
  center: { textAlign: 'center' },
  slots: { flexDirection: 'row', gap: 8 },
  slot: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rules: { borderRadius: 14, padding: 12, gap: 10 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ruleBadge: { width: 52, textAlign: 'center' },
  ruleText: { flex: 1 },
  enter: { gap: 6 },
});
