/**
 * Écran 32 · Rejoindre une ligue publique (planche LiguePublique) : l'organisateur et sa
 * caution, les places prises et la clôture, entrée, échelon, début, format, ce qu'on gagne,
 * la règle des forfaits, puis « S'inscrire · bloquer … » ou « Il te manque … cauris ».
 * Le créateur y trouve son espace (33).
 */
import { forfeitFine } from '@kwatt/domain';
import type { LeagueDetail } from '@kwatt/protocol';
import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { translateError, useFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { Button, ConfirmSheet, ProgressBar, Screen, SectionLabel, Text, showToast } from '@/ui';
import { OnWood } from '../../dames/FabricHeader';
import { useLeague, useLeagueAction } from '../api';
import { LeagueBand, Note, PlayerAvatar, QueryBody, Row, RowGroup, useLeagueDates } from '../components';
import { daysHours, fillRatio } from '../logic';

function PublicLeague({ league }: { league: LeagueDetail }) {
  const { t } = useTranslation('leagues');
  const { t: tc } = useTranslation('common');
  const f = useFormat();
  const { colors } = useTheme();
  const dates = useLeagueDates();
  const action = useLeagueAction(league.id);
  const [confirmLeave, setConfirmLeave] = useState(false);
  if (league.status === 'running' || league.status === 'finished') {
    return <Redirect href={`/ligue/${league.code}${league.format === 'cup' ? '/coupe' : ''}` as Href} />;
  }
  const active = league.members.filter((m) => m.status === 'active').length;
  const closes = league.registrationClosesAt ? daysHours(Date.parse(league.registrationClosesAt) - Date.now()) : null;
  const balance = league.me.balance;
  const missing = balance !== null && balance < league.entry ? league.entry - balance : 0;
  const fine = forfeitFine(league.entry);
  const run = (name: 'join' | 'leave') =>
    action.mutate(name, {
      onSuccess: () => {
        setConfirmLeave(false);
        showToast(t(name === 'join' ? 'join.done' : 'join.left'), 'success');
      },
      onError: (error) => showToast(translateError(error), 'alert'),
    });
  const status =
    league.status === 'registration' ? t('join.open') : league.status === 'awaiting_validation' ? t('join.closed') : t('detail.cancelled');

  return (
    <>
      <LeagueBand game={league.game} kicker={status} title={league.name}>
        <View style={[styles.organizer, { backgroundColor: colors.overlay }]}>
          <PlayerAvatar player={league.creator} size={40} />
          <View style={styles.organizerTexts}>
            <OnWood variant="smallStrong">{t('join.organizer', { name: league.creator.pseudo })}</OnWood>
            <OnWood variant="caption">{t('join.caution', { amount: f.caurisAmount(league.caution) })}</OnWood>
          </View>
        </View>
      </LeagueBand>
      <View style={styles.body}>
        <View style={[styles.places, { backgroundColor: colors.surface }]}>
          <View style={styles.placesRow}>
            <Text variant="bodyStrong">{t('join.taken', { count: active, max: league.maxPlaces })}</Text>
            {closes && league.status === 'registration' ? (
              <Text variant="caption" tone="muted">
                {t('join.closesIn', { days: closes.days, hours: String(closes.hours).padStart(2, '0') })}
              </Text>
            ) : null}
          </View>
          <ProgressBar value={fillRatio(active, league.maxPlaces)} accessibilityLabel={t('join.taken', { count: active, max: league.maxPlaces })} />
        </View>
        <RowGroup>
          <Row label={t('public.entry')} value={f.cauris(league.entry)} />
          <Row label={t('public.minRank')} value={league.minRank ? tc(`rank.${league.minRank}`) : t('public.anyRank')} />
          <Row label={t('join.start')} value={t('join.startValue', { day: dates.day(league.firstDay), rhythm: t(`rhythm.${league.rhythm}`) })} />
          <Row label={t('create.format')} value={t(`format.${league.format}.short`)} last />
        </RowGroup>
        <SectionLabel>{t('join.prizes', { amount: f.caurisAmount(league.pot) })}</SectionLabel>
        <RowGroup>
          <Row label={t('join.champion')} value={t('join.championValue', { amount: f.caurisAmount(league.prizes.first) })} />
          <Row label={t('join.podium')} value={`${f.caurisAmount(league.prizes.second)} · ${f.caurisAmount(league.prizes.third)}`} />
          <Row label={t('join.finisher')} value={t('join.finisherValue', { amount: f.caurisAmount(league.prizes.participationEach) })} last />
        </RowGroup>
        <Note>{t(league.rhythm === 'daily' ? 'join.rulesDaily' : 'join.rulesWeekly', { fine: f.caurisAmount(fine) })}</Note>
        {league.me.creator ? (
          <Button label={t('join.creatorSpace')} icon="settings" onPress={() => router.push(`/ligue/${league.id}/valider` as Href)} />
        ) : league.me.member ? (
          <>
            <Note tone="gain">{t('join.registered', { amount: f.caurisAmount(league.entry) })}</Note>
            {league.status === 'registration' ? <Button label={t('registration.leave')} variant="outline" onPress={() => setConfirmLeave(true)} /> : null}
          </>
        ) : missing > 0 ? (
          <View style={styles.short}>
            <Button label={t('join.missing', { amount: f.caurisAmount(missing) })} disabled />
            <Button label={t('join.earn')} variant="ghost" onPress={() => router.push('/dames/machine' as Href)} />
          </View>
        ) : league.me.joinRefusal ? (
          <Note tone="alert">{t(`refusal.${league.me.joinRefusal.replace(/^league\./, '')}`, { defaultValue: t('refusal.generic') })}</Note>
        ) : league.status === 'registration' ? (
          <>
            <Button
              label={t('join.submit', { amount: f.caurisAmount(league.entry) })}
              loading={action.isPending}
              onPress={() => run('join')}
            />
            <Text variant="caption" tone="muted" align="center">
              {t('join.balanceHint', { balance: f.caurisAmount(balance ?? 0) })}
            </Text>
          </>
        ) : null}
      </View>
      <ConfirmSheet
        visible={confirmLeave}
        title={t('registration.leaveTitle')}
        message={t('registration.leaveRefund', { amount: f.caurisAmount(league.entry) })}
        confirmLabel={t('registration.leave')}
        onConfirm={() => run('leave')}
        onCancel={() => setConfirmLeave(false)}
      />
    </>
  );
}

export function PublicLeagueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLeague(id);
  return (
    <Screen padded={false} gap={0} testID="screen-ligue-publique" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <QueryBody query={query}>{(league) => <PublicLeague league={league} />}</QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  organizer: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 10 },
  organizerTexts: { flex: 1, gap: 2 },
  places: { borderRadius: 14, padding: 14, gap: 10 },
  placesRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  short: { gap: 6 },
});
