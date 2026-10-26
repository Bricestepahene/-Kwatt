/**
 * Écran 28 · Créer une ligue privée (planche CreerLigue) : format (championnat ou coupe),
 * jeu, accès (publique → 31), réglages, plateaux et règles (→ 28b), points, calendrier,
 * droit d'entrée, récompenses, puis « Créer et partager le code ».
 */
import { LEAGUE_TIME_SLOTS, type LeagueFormat, type LeagueGame } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import { translateError, useFormat } from '@/i18n';
import { useAccessSession } from '@/session';
import { Button, Header, Screen, SectionLabel, SegmentedTabs, Text, TextField, formatRoomCode, showToast } from '@/ui';
import { useCreateLeague } from '../api';
import { ChoiceBox, Note, Row, RowGroup, Stepper, useLeagueDates } from '../components';
import { setLeagueDraft, startDraft, useLeagueDraft } from '../draftStore';
import { addDays, championshipRounds, clampStep, cupShapes, draftRequest, knockoutLevels, kwattToday, leagueHref, withGame } from '../logic';

export function CreateLeagueScreen() {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const dates = useLeagueDates();
  const session = useAccessSession();
  const draft = useLeagueDraft();
  const create = useCreateLeague();
  useEffect(() => startDraft('private'), []);

  const set = (patch: Partial<typeof draft>) => setLeagueDraft((d) => ({ ...d, ...patch }));
  const isCup = draft.format === 'cup';
  const shapes = cupShapes(draft.maxPlaces);
  const shapeIndex = Math.max(0, shapes.findIndex((s) => s.groups === draft.groups && s.qualifiersPerGroup === draft.qualifiersPerGroup));
  const shape = shapes[shapeIndex] ?? { groups: 1, qualifiersPerGroup: 2 };
  const qualified = shape.groups * shape.qualifiersPerGroup;
  const rounds = draft.game === 'ludo' ? draft.rounds : championshipRounds(draft.maxPlaces, draft.doubleRound);
  const nextSlot = LEAGUE_TIME_SLOTS[(LEAGUE_TIME_SLOTS.indexOf(draft.defaultTime as (typeof LEAGUE_TIME_SLOTS)[number]) + 1) % LEAGUE_TIME_SLOTS.length]!;
  const policy = t(`rules.policyShort.${draft.boardRules.policy}`, { board: t(`board.${draft.boardRules.defaultBoard}`) });
  const entryLocked = !session.isAdult;
  const nameOk = draft.name.trim().length >= 3;

  const setPlaces = (n: number) => {
    const maxPlaces = clampStep(n, 2, 64, 1);
    const next = cupShapes(maxPlaces);
    const keep = next.find((s) => s.groups === draft.groups && s.qualifiersPerGroup === draft.qualifiersPerGroup) ?? next[next.length - 1];
    set({ maxPlaces, relegated: Math.min(draft.relegated, Math.max(0, maxPlaces - 3)), ...(keep ? { groups: keep.groups, qualifiersPerGroup: keep.qualifiersPerGroup } : {}) });
  };

  const submit = () => {
    const body = draftRequest({ ...draft, ...(isCup ? shape : {}), entry: entryLocked ? 0 : draft.entry });
    create.mutate(body, {
      onSuccess: (league) => {
        router.replace(leagueHref(league) as Href);
        void Share.share({ message: t('create.shareText', { name: league.name, code: formatRoomCode(league.code), link: `kwatt://ligue/${league.code}` }) }).catch(() => undefined);
      },
      onError: (error) => showToast(translateError(error), 'alert'),
    });
  };

  return (
    <Screen testID="screen-creer-ligue" header={<Header title={t('create.title')} fallback="/ligues" />}>
      <TextField
        label={t('create.name')}
        value={draft.name}
        onChangeText={(name) => set({ name })}
        placeholder={t('create.namePlaceholder')}
        maxLength={40}
      />
      <SectionLabel>{t('create.format')}</SectionLabel>
      <View style={styles.formats}>
        {(['championship', 'cup'] as const satisfies readonly LeagueFormat[]).map((format) => (
          <ChoiceBox
            key={format}
            selected={draft.format === format}
            onPress={() => (draft.game === 'ludo' && format === 'cup' ? showToast(t('create.cupDamesOnly')) : set({ format }))}
            title={t(`format.${format}.label`)}
            sub={t(`format.${format}.desc`)}
            style={styles.format}
          />
        ))}
      </View>
      <RowGroup>
        <Row
          label={t('create.game')}
          right={
            <SegmentedTabs<LeagueGame>
              accessibilityLabel={t('create.game')}
              value={draft.game}
              onChange={(game) => setLeagueDraft((d) => withGame(d, game))}
              options={[
                { value: 'dames', label: t('game.dames') },
                { value: 'ludo', label: t('game.ludo') },
              ]}
              style={styles.segment}
            />
          }
        />
        <Row
          label={t('create.access')}
          value={t('create.private')}
          {...(session.isAdult
            ? { onPress: () => router.push('/ligue-publique/nouvelle' as Href), accessibilityLabel: t('create.toPublic') }
            : {})}
          last
        />
      </RowGroup>

      <SectionLabel>{t('create.settings')}</SectionLabel>
      <RowGroup>
        <Row
          label={t('create.players')}
          right={
            <Stepper
              value={f.number(draft.maxPlaces)}
              onMinus={() => setPlaces(draft.maxPlaces - 1)}
              onPlus={() => setPlaces(draft.maxPlaces + 1)}
              minusLabel={t('create.fewerPlayers')}
              plusLabel={t('create.morePlayers')}
              minusDisabled={draft.maxPlaces <= 2}
              plusDisabled={draft.maxPlaces >= 64}
            />
          }
        />
        {isCup ? (
          <>
            <Row
              label={t('create.groups')}
              value={t('create.groupsValue', { count: shape.groups, size: Math.ceil(draft.maxPlaces / shape.groups) })}
              onPress={() => {
                const next = shapes[(shapeIndex + 1) % shapes.length];
                if (next) set({ groups: next.groups, qualifiersPerGroup: next.qualifiersPerGroup });
              }}
            />
            <Row label={t('create.qualifiers')} value={t('create.qualifiersValue', { count: shape.qualifiersPerGroup })} />
            <Row label={t('create.knockout')} value={t(`create.knockoutValue.${String(Math.min(knockoutLevels(qualified), 4)) as '1' | '2' | '3' | '4'}`)} />
          </>
        ) : draft.game === 'ludo' ? (
          <Row
            label={t('create.rounds')}
            right={
              <Stepper
                value={f.number(draft.rounds)}
                onMinus={() => set({ rounds: Math.max(1, draft.rounds - 1) })}
                onPlus={() => set({ rounds: Math.min(60, draft.rounds + 1) })}
                minusLabel={t('create.fewerRounds')}
                plusLabel={t('create.moreRounds')}
                minusDisabled={draft.rounds <= 1}
                plusDisabled={draft.rounds >= 60}
              />
            }
          />
        ) : (
          <>
            <Row
              label={t('create.legs')}
              value={t(draft.doubleRound ? 'create.double' : 'create.single')}
              onPress={() => set({ doubleRound: !draft.doubleRound })}
            />
            <Row label={t('create.rounds')} value={f.number(rounds)} />
            <Row
              label={t('create.relegated')}
              right={
                <Stepper
                  value={f.number(draft.relegated)}
                  onMinus={() => set({ relegated: Math.max(0, draft.relegated - 1) })}
                  onPlus={() => set({ relegated: Math.min(8, draft.maxPlaces - 3, draft.relegated + 1) })}
                  minusLabel={t('create.fewerRelegated')}
                  plusLabel={t('create.moreRelegated')}
                  minusDisabled={draft.relegated <= 0}
                  plusDisabled={draft.relegated >= Math.min(8, draft.maxPlaces - 3)}
                />
              }
            />
          </>
        )}
        <Row label={t('create.boards')} value={policy} onPress={() => router.push('/ligue/regles' as Href)} />
        <Row label={t('create.points')} value={t(draft.game === 'ludo' ? 'create.pointsLudo' : 'create.pointsDames')} />
        <Row
          label={t('create.rhythm')}
          value={t(`rhythm.${draft.rhythm}`)}
          onPress={() => set({ rhythm: draft.rhythm === 'daily' ? 'weekly' : 'daily' })}
        />
        <Row
          label={t('create.calendar')}
          value={t('create.calendarValue', { weekday: dates.weekday(draft.firstDay), time: draft.defaultTime })}
          onPress={() => set({ defaultTime: nextSlot })}
          accessibilityLabel={t('create.calendarChange', { time: nextSlot })}
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
              minusDisabled={draft.firstDay <= kwattToday()}
            />
          }
        />
        <Row
          label={t('create.entry')}
          last
          right={
            entryLocked ? (
              <Text variant="labelStrong">{t('create.entryFree')}</Text>
            ) : (
              <Stepper
                value={draft.entry === 0 ? t('create.free') : f.caurisAmount(draft.entry)}
                onMinus={() => set({ entry: Math.max(0, draft.entry - 50) })}
                onPlus={() => set({ entry: Math.min(1000, draft.entry + 50) })}
                minusLabel={t('create.lowerEntry')}
                plusLabel={t('create.raiseEntry')}
                minusDisabled={draft.entry <= 0}
                plusDisabled={draft.entry >= 1000}
              />
            )
          }
        />
      </RowGroup>
      <Note>
        <Text variant="small">
          <Text variant="smallStrong">{t('create.rewardsTitle')}</Text> {t(draft.entry > 0 && !entryLocked ? 'create.rewardsPot' : 'create.rewards')}
        </Text>
      </Note>
      <Button
        label={t('create.submit')}
        icon="share"
        loading={create.isPending}
        disabled={!nameOk || create.isPending}
        accessibilityHint={nameOk ? undefined : t('create.nameHint')}
        onPress={submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  formats: { flexDirection: 'row', gap: 10 },
  format: { flex: 1, minHeight: 96, alignItems: 'flex-start' },
  segment: { width: 170 },
});
