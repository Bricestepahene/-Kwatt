/**
 * Écran 31 · Créer une ligue publique (planche CreerLiguePublique) : places et entrée (−/+),
 * minimum pour démarrer, échelon minimum, plateau (→ 28b), dates, puis la caution, le pot si
 * complet, la part du champion et celle du créateur. « Déposer … et publier » bloque la
 * caution (rendue à la fin) ; le créateur valide ensuite la ligue (33).
 */
import { PUBLIC_LEAGUE_ENTRY, PUBLIC_LEAGUE_PLACES } from '@kwatt/domain';
import { RANK_ID_VALUES, type LeagueFormat } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { translateError, useFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { Button, Screen, SectionLabel, Text, TextField, showToast } from '@/ui';
import { useWallet } from '../../dames/api';
import { useCreateLeague } from '../api';
import { LeagueBand, Note, Row, RowGroup, Stepper, useLeagueDates } from '../components';
import { setLeagueDraft, startDraft, useLeagueDraft } from '../draftStore';
import { addDays, clampStep, defaultDraft, draftRequest, kwattToday, publicPreview } from '../logic';

const MIN_RANKS = [null, ...RANK_ID_VALUES.filter((r) => r !== 'fon')] as const;

export function CreatePublicLeagueScreen() {
  const { t } = useTranslation('leagues');
  const { t: tc } = useTranslation('common');
  const f = useFormat();
  const { colors } = useTheme();
  const dates = useLeagueDates();
  const draft = useLeagueDraft();
  const wallet = useWallet();
  const create = useCreateLeague();
  useEffect(() => startDraft('public'), []);

  const set = (patch: Partial<typeof draft>) => setLeagueDraft((d) => ({ ...d, ...patch }));
  const p = PUBLIC_LEAGUE_PLACES;
  const e = PUBLIC_LEAGUE_ENTRY;
  const preview = publicPreview(draft.maxPlaces, draft.entry);
  const balance = wallet.data?.balance ?? null;
  const tooMuch = balance !== null && preview.caution > balance;
  const rankIndex = Math.max(0, MIN_RANKS.indexOf(draft.minRank as (typeof MIN_RANKS)[number]));
  const nameOk = draft.name.trim().length >= 3;
  const board =
    draft.boardRules.policy === 'imposed'
      ? t('public.boardImposed', { board: t(`board.${draft.boardRules.defaultBoard}`) })
      : t(`rules.policyShort.${draft.boardRules.policy}`, { board: '' }).trim();

  const setCloses = (closesDay: string) => {
    const firstDay = draft.firstDay <= closesDay ? addDays(closesDay, 1) : draft.firstDay;
    set({ closesDay, firstDay });
  };

  const submit = () =>
    create.mutate(draftRequest(draft), {
      onSuccess: (league) => {
        setLeagueDraft(defaultDraft('public', Date.now(), draft.game));
        router.replace(`/ligue-publique/${league.id}` as Href);
      },
      onError: (error) => showToast(translateError(error), 'alert'),
    });

  return (
    <Screen padded={false} gap={0} testID="screen-creer-ligue-publique">
      <LeagueBand
        game={draft.game}
        kicker={t('public.kicker', { game: t(`game.${draft.game}`) })}
        title={nameOk ? draft.name.trim() : t('public.untitled')}
        fallback="/ligue/nouvelle"
      />
      <View style={styles.body}>
        <TextField label={t('create.name')} value={draft.name} onChangeText={(name) => set({ name })} placeholder={t('public.namePlaceholder')} maxLength={40} />
        <SectionLabel>{t('public.placesEntry')}</SectionLabel>
        <RowGroup>
          <Row
            label={t('public.places')}
            right={
              <Stepper
                value={f.number(draft.maxPlaces)}
                onMinus={() => set({ maxPlaces: clampStep(draft.maxPlaces - p.step, p.min, p.max, p.step) })}
                onPlus={() => set({ maxPlaces: clampStep(draft.maxPlaces + p.step, p.min, p.max, p.step) })}
                minusLabel={t('public.fewerPlaces')}
                plusLabel={t('public.morePlaces')}
                minusDisabled={draft.maxPlaces <= p.min}
                plusDisabled={draft.maxPlaces >= p.max}
              />
            }
          />
          <Row
            label={t('public.entry')}
            right={
              <Stepper
                value={f.caurisAmount(draft.entry)}
                onMinus={() => set({ entry: clampStep(draft.entry - e.step, e.min, e.max, e.step) })}
                onPlus={() => set({ entry: clampStep(draft.entry + e.step, e.min, e.max, e.step) })}
                minusLabel={t('create.lowerEntry')}
                plusLabel={t('create.raiseEntry')}
                minusDisabled={draft.entry <= e.min}
                plusDisabled={draft.entry >= e.max}
              />
            }
          />
          <Row label={t('public.minPlayers')} value={t('public.playersCount', { count: preview.minPlayers })} />
          <Row
            label={t('public.minRank')}
            value={draft.minRank ? tc(`rank.${draft.minRank}`) : t('public.anyRank')}
            onPress={() => set({ minRank: MIN_RANKS[(rankIndex + 1) % MIN_RANKS.length] ?? null })}
          />
          {draft.game === 'dames' ? (
            <Row
              label={t('create.format')}
              value={t(`format.${draft.format}.label`)}
              onPress={() => set({ format: (draft.format === 'cup' ? 'championship' : 'cup') satisfies LeagueFormat })}
            />
          ) : null}
          <Row label={t('public.board')} value={board} onPress={() => router.push('/ligue/regles' as Href)} last />
        </RowGroup>

        <SectionLabel>{t('public.dates')}</SectionLabel>
        <RowGroup>
          <Row
            label={t('public.closes')}
            right={
              <Stepper
                value={dates.day(draft.closesDay)}
                onMinus={() => setCloses(addDays(draft.closesDay, -1))}
                onPlus={() => setCloses(addDays(draft.closesDay, 1))}
                minusLabel={t('create.dayEarlier')}
                plusLabel={t('create.dayLater')}
                minusDisabled={draft.closesDay <= kwattToday()}
              />
            }
          />
          <Row
            label={t('create.firstDay')}
            right={
              <Stepper
                value={dates.day(draft.firstDay)}
                onMinus={() => set({ firstDay: addDays(draft.firstDay, -1) })}
                onPlus={() => set({ firstDay: addDays(draft.firstDay, 1) })}
                minusLabel={t('create.dayEarlier')}
                plusLabel={t('create.dayLater')}
                minusDisabled={draft.firstDay <= addDays(draft.closesDay, 1)}
              />
            }
          />
          <Row
            label={t('create.rhythm')}
            value={t(`rhythm.${draft.rhythm}`)}
            onPress={() => set({ rhythm: draft.rhythm === 'daily' ? 'weekly' : 'daily' })}
            last
          />
        </RowGroup>

        <View style={[styles.money, { backgroundColor: colors.surfaceStrong }]}>
          {(
            [
              ['public.caution', preview.caution],
              ['public.potIfFull', preview.pot],
              ['public.champion', preview.first],
              ['public.creatorShare', preview.creator],
            ] as const
          ).map(([key, amount]) => (
            <View key={key} style={styles.moneyRow} accessible accessibilityLabel={`${t(key)} ${f.cauris(amount)}`}>
              <Text variant="small" style={styles.moneyLabel}>
                {t(key)}
              </Text>
              <Text variant="number">{f.caurisAmount(amount)}</Text>
            </View>
          ))}
        </View>
        {tooMuch ? <Note tone="alert">{t('public.tooMuch', { balance: f.caurisAmount(balance ?? 0) })}</Note> : null}
        <Button
          label={t('public.submit', { amount: f.caurisAmount(preview.caution) })}
          loading={create.isPending}
          disabled={!nameOk || tooMuch || create.isPending}
          onPress={submit}
        />
        <Text variant="caption" tone="muted" align="center">
          {t('public.submitHint')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  money: { borderRadius: 14, padding: 14, gap: 8 },
  moneyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  moneyLabel: { flex: 1 },
});
