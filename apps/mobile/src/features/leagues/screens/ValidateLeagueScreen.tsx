/**
 * Écran 33 · Le créateur valide la ligue (planche ValiderLigue) : inscriptions closes et
 * délai de 48 h, inscrits (touche pour retirer), calendrier qui sera tiré au sort,
 * « Valider et lancer le tirage » ou « Annuler · tout le monde est remboursé ». Une fois
 * lancée : la journée 1 et ses heures. Réservé au créateur (le serveur fait foi).
 */
import type { LeagueDetail, LeaguePlayer } from '@kwatt/protocol';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { translateError, useFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { Button, Chip, ConfirmSheet, EmptyState, Screen, SectionLabel, Text, showToast } from '@/ui';
import { useLeague, useLeagueAction, useRemoveMember } from '../api';
import { LeagueBand, Note, QueryBody, StatTiles, useLeagueDates } from '../components';
import { hoursMinutes, leagueHref } from '../logic';

const SHOWN_MATCHES = 4;

function Launched({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const { colors } = useTheme();
  const dates = useLeagueDates();
  const matches = league.roundMatches;
  const active = league.members.filter((m) => m.status === 'active').length;
  return (
    <>
      <Note tone="gain">
        <View style={styles.launched}>
          <Text variant="subheading" tone="gain">
            {t('validate.launched')}
          </Text>
          <Text variant="small">{t('validate.launchedBody', { count: active, day: dates.day(league.firstDay) })}</Text>
        </View>
      </Note>
      {matches.length > 0 ? (
        <>
          <SectionLabel>{t('validate.roundOf', { round: matches[0]!.round, day: dates.day(matches[0]!.day) })}</SectionLabel>
          <View style={[styles.matches, { backgroundColor: colors.surface }]}>
            {matches.slice(0, SHOWN_MATCHES).map((m) => (
              <View key={m.id} style={styles.matchRow}>
                <Text variant="small" style={styles.matchName} numberOfLines={1}>
                  {m.players.map((p) => p.pseudo).join(' – ')}
                </Text>
                <Text variant="smallStrong" tone={m.timeAgreed ? 'default' : 'muted'}>
                  {m.timeAgreed ? dates.time(m.matchAt) : t('validate.toSet', { time: dates.time(m.matchAt) })}
                </Text>
              </View>
            ))}
            {matches.length > SHOWN_MATCHES ? (
              <Text variant="caption" tone="muted">
                {t('validate.more', { count: matches.length - SHOWN_MATCHES })}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
      <Button label={t('validate.follow')} onPress={() => router.replace(leagueHref({ ...league, status: 'running' }) as Href)} />
    </>
  );
}

function Pending({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const dates = useLeagueDates();
  const action = useLeagueAction(league.id);
  const remove = useRemoveMember(league.id);
  const [removing, setRemoving] = useState<LeaguePlayer | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const active = league.members.filter((m) => m.status === 'active' && m.player.userId !== league.creator.userId);
  const full = active.length >= league.maxPlaces;
  const closed = league.status === 'awaiting_validation';
  const left = league.validationDeadline ? hoursMinutes(Date.parse(league.validationDeadline) - Date.now()) : null;
  const enough = active.length >= league.minPlayers;
  const onError = (error: unknown) => showToast(translateError(error), 'alert');

  return (
    <>
      <View style={styles.statusCard}>
        <Note tone={closed ? 'info' : 'gain'}>
          <View style={styles.statusInner}>
            <View style={styles.statusTop}>
              <Text variant="bodyStrong">{t(closed ? 'validate.closed' : 'validate.open')}</Text>
              {closed && left ? (
                <Text variant="smallStrong" tone="action">
                  {t('validate.within', { hours: left.hours })}
                </Text>
              ) : null}
            </View>
            <Text variant="small" tone="muted">
              {t(enough ? 'validate.countEnough' : 'validate.countShort', {
                count: active.length,
                max: league.maxPlaces,
                min: league.minPlayers,
                pot: f.caurisAmount(league.pot),
              })}
            </Text>
          </View>
        </Note>
      </View>
      <SectionLabel>{t('validate.members')}</SectionLabel>
      {active.length === 0 ? (
        <EmptyState compact icon="friends" title={t('validate.noMembers')} />
      ) : (
        <View style={styles.chips}>
          {active.map((m) => (
            <Chip key={m.player.userId} label={m.player.pseudo} icon="close" onPress={() => setRemoving(m.player)} />
          ))}
        </View>
      )}
      <SectionLabel>{t('validate.calendar')}</SectionLabel>
      <StatTiles
        items={[
          { value: f.number(league.totalRounds), label: t('validate.rounds', { count: league.totalRounds }) },
          { value: f.number(league.totalMatches), label: t('validate.matches', { count: league.totalMatches }) },
          { value: dates.day(league.endDay), label: t('validate.end') },
        ]}
      />
      <Note tone="alert">{t('validate.warning', { amount: f.caurisAmount(league.caution) })}</Note>
      <View style={styles.actions}>
        <Button
          label={t('validate.submit')}
          loading={action.isPending && action.variables === 'validate'}
          disabled={!(closed || full) || !enough || action.isPending}
          onPress={() => action.mutate('validate', { onError })}
        />
        <Button label={t('validate.cancel')} variant="ghost" onPress={() => setCancelling(true)} />
      </View>
      <ConfirmSheet
        visible={removing !== null}
        title={t('validate.removeTitle', { name: removing?.pseudo ?? '' })}
        message={t('validate.removeBody', { amount: f.caurisAmount(league.entry) })}
        confirmLabel={t('validate.remove')}
        onConfirm={() => {
          if (removing) remove.mutate(removing.userId, { onSettled: () => setRemoving(null), onError });
        }}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmSheet
        visible={cancelling}
        title={t('validate.cancelTitle')}
        message={t('validate.cancelBody')}
        confirmLabel={t('validate.cancelConfirm')}
        onConfirm={() => action.mutate('cancel', { onSettled: () => setCancelling(false), onError })}
        onCancel={() => setCancelling(false)}
      />
    </>
  );
}

function Validate({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  return (
    <>
      <LeagueBand game={league.game} kicker={t('validate.kicker')} title={league.name} />
      <View style={styles.body}>
        {!league.me.creator ? (
          <EmptyState icon="lock" title={t('validate.notCreator')} action={{ label: t('validate.follow'), onPress: () => router.replace(leagueHref(league) as Href) }} />
        ) : league.status === 'running' || league.status === 'finished' ? (
          <Launched league={league} />
        ) : league.status === 'cancelled' ? (
          <Note tone="alert">{t('detail.cancelledBody')}</Note>
        ) : (
          <Pending league={league} />
        )}
      </View>
    </>
  );
}

export function ValidateLeagueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLeague(id);
  return (
    <Screen padded={false} gap={0} testID="screen-valider-ligue" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <QueryBody query={query}>{(league) => <Validate league={league} />}</QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  statusCard: {},
  statusInner: { gap: 4 },
  statusTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actions: { gap: 8 },
  launched: { gap: 4 },
  matches: { borderRadius: 14, padding: 12, gap: 8 },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  matchName: { flex: 1, minWidth: 0 },
});
