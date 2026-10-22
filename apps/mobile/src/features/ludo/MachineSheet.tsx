/**
 * Lancement d'une partie contre 1 à 3 machines (écran 20 « Contre 1 à 3 machines », reprend
 * la planche DefiMachine pour le Ludo) : nombre de machines, difficulté (offres C2 : cote,
 * gain de base, Fon verrouillé avant Chef, difficulté auto), pari en ligne (C3) pour un
 * profil majeur, sinon partie locale jouable sans réseau.
 */
import { MACHINE_DIFFICULTY_CODES, type MachineDifficultyCode, type MachineOffersResponse } from '@kwatt/protocol';
import { randomUUID } from 'expo-crypto';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useDynamicT, useFormat } from '@/i18n';
import { useIsOffline } from '@/offline';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { BottomSheet, Button, IconButton, SegmentedTabs, showToast, Text } from '@/ui';
import { createOnlineMachineGame, useMachineOffers } from './api';
import { newSeed } from './local/controller';
import { startLocalLudo } from './local/runtime';
import { clampMachines, isRankedSetup, machineCounts, variantId, type LudoSetup } from './setup';

type Choice = 'auto' | MachineDifficultyCode;

/** Difficultés proposées hors connexion (sans cote ; Fon verrouillé faute de connaître l'échelon). */
export function offlineDifficulties(): { id: MachineDifficultyCode; unlocked: boolean }[] {
  return MACHINE_DIFFICULTY_CODES.map((id) => ({ id, unlocked: id !== 'fon' }));
}

/** Gain si on gagne avec un pari (base + mise × (cote − 1)), comme la planche DefiMachine. */
export function betPreview(baseReward: number, bet: number, oddsHundredths: number): { win: number; lose: number } {
  return { win: baseReward + Math.floor((bet * (oddsHundredths - 100)) / 100), lose: bet > 0 ? -(bet - 10) : 10 };
}

export function MachineSheet({ visible, onClose, setup }: { visible: boolean; onClose: () => void; setup: LudoSetup }) {
  const { t } = useTranslation('ludo');
  const td = useDynamicT();
  const f = useFormat();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const offline = useIsOffline();
  const user = useSession((s) => s.data?.user);
  const member = user?.kind === 'member';
  const counts = machineCounts(setup.preset);
  const [machines, setMachines] = useState(() => clampMachines(setup.preset, 3));
  const [choice, setChoice] = useState<Choice>('auto');
  const [bet, setBet] = useState(0);
  const [busy, setBusy] = useState(false);
  const friendly = !isRankedSetup(setup) || setup.house !== null;
  const offers = useMachineOffers(variantId(setup.preset), machines, visible && member && !offline);
  const data: MachineOffersResponse | undefined = offers.isError ? undefined : offers.data;

  useEffect(() => setMachines((m) => clampMachines(setup.preset, m)), [setup.preset]);
  useEffect(() => {
    if (!visible) setBet(0);
  }, [visible]);

  const difficulties = useMemo(
    () => (data ? data.difficulties.map((d) => ({ id: d.id, unlocked: d.unlocked, offer: d })) : offlineDifficulties().map((d) => ({ ...d, offer: undefined }))),
    [data],
  );
  const autoDifficulty: MachineDifficultyCode = data?.auto.difficulty ?? 'moyen';
  const difficulty: MachineDifficultyCode = choice === 'auto' ? autoDifficulty : choice;
  const offer = data?.difficulties.find((d) => d.id === difficulty);
  const canBet = !!data && !offline && !friendly && data.betCap >= 50 && user?.ageBand === 'adult';
  const betCap = canBet ? data!.betCap : 0;
  const shownBet = Math.min(bet, betCap);
  const preview = offer && shownBet > 0 ? betPreview(offer.baseReward, shownBet, offer.oddsHundredths) : null;
  const left = data ? Math.max(0, data.dailyLimit - data.rewardedToday) : null;

  const start = async () => {
    if (busy) return;
    if (shownBet > 0) {
      setBusy(true);
      try {
        const { gameId } = await createOnlineMachineGame({
          family: 'ludo',
          variant: variantId(setup.preset) as never,
          difficulty,
          mode: choice === 'auto' ? 'auto' : 'chosen',
          bet: shownBet,
          machines,
        });
        onClose();
        router.push(`/ludo/partie/${encodeURIComponent(gameId)}` as Href);
      } catch {
        showToast(t('machineSheet.betFailed'), 'alert');
      } finally {
        setBusy(false);
      }
      return;
    }
    const names = [user?.pseudo ?? t('game.you'), ...Array.from({ length: machines }, (_, i) => t('game.machineName', { n: i + 1 }))];
    const c = startLocalLudo({
      id: `ludo-${randomUUID()}`,
      setup: { preset: setup.preset, house: setup.house },
      machines,
      difficulty,
      mode: choice === 'auto' ? 'auto' : 'chosen',
      seed: newSeed(),
      names,
      submit: member && setup.house === null,
      createdAt: Date.now(),
    });
    onClose();
    router.push(`/ludo/partie/${encodeURIComponent(c.id)}` as Href);
  };

  const levelName = (id: MachineDifficultyCode) => td(`ludo:machineSheet.levels.${id}.name`);

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('machineSheet.title')}>
      <ScrollView style={{ maxHeight: height * 0.78 }} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Text variant="title" accessibilityRole="header">
            {t('machineSheet.title')}
          </Text>
          <Text variant="small" tone="muted">
            {t('machineSheet.subtitle', { name: setup.houseSet ? `${td(`ludo:board.${setup.preset}.name`)} · ${setup.houseSet.name}` : td(`ludo:board.${setup.preset}.name`) })}
          </Text>
        </View>

        <Text variant="section" tone="muted">
          {t('machineSheet.machines')}
        </Text>
        {counts.length > 1 ? (
          <SegmentedTabs<string>
            accessibilityLabel={t('machineSheet.machines')}
            value={String(machines)}
            onChange={(v) => setMachines(Number(v))}
            options={counts.map((n) => ({ value: String(n), label: t('machineSheet.machinesCount', { count: n }) }))}
          />
        ) : (
          <Text variant="small" tone="muted">
            {setup.preset === 'pachisi' ? t('machineSheet.pachisiNote') : t('machineSheet.machinesCount', { count: counts[0] ?? 1 })}
          </Text>
        )}

        <View style={styles.rowBetween}>
          <Text variant="section" tone="muted">
            {t('machineSheet.difficulty')}
          </Text>
          {data ? (
            <Text variant="caption" tone="muted">
              {t('machineSheet.oddsHint')}
            </Text>
          ) : null}
        </View>
        <View style={styles.levels} accessibilityRole="radiogroup">
          <LevelRow
            selected={choice === 'auto'}
            title={t('machineSheet.auto', { name: levelName(autoDifficulty) })}
            desc={t('machineSheet.autoDesc')}
            onPress={() => setChoice('auto')}
          />
          {difficulties.map((d) => (
            <LevelRow
              key={d.id}
              selected={choice === d.id}
              disabled={!d.unlocked}
              title={d.unlocked ? levelName(d.id) : t('machineSheet.locked', { name: levelName(d.id) })}
              desc={d.offer ? t('machineSheet.chance', { percent: Math.round(d.offer.p * 100) }) : td(`ludo:machineSheet.levels.${d.id}.desc`)}
              right={d.offer && !friendly ? t('machineSheet.odds', { odds: f.number(d.offer.odds, 1) }) : undefined}
              onPress={() => setChoice(d.id)}
            />
          ))}
        </View>

        {canBet ? (
          <View style={[styles.bet, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <Text variant="section" tone="muted">
                {t('machineSheet.bet')}
              </Text>
              <Text variant="caption" tone="muted">
                {t('machineSheet.betCap', { amount: f.cauris(betCap) })}
              </Text>
            </View>
            <View style={styles.stepper}>
              <IconButton icon="minus" accessibilityLabel={t('machineSheet.betMinus')} onPress={() => setBet(Math.max(0, shownBet - 50))} disabled={shownBet <= 0} size={48} />
              <Text variant="numberLarge" style={styles.betValue} accessibilityLiveRegion="polite">
                {f.number(shownBet)}
              </Text>
              <IconButton icon="plus" accessibilityLabel={t('machineSheet.betPlus')} onPress={() => setBet(Math.min(betCap, shownBet + 50))} disabled={shownBet >= betCap} size={48} />
            </View>
            {preview ? (
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text variant="caption" tone="muted">
                    {t('machineSheet.ifWin')}
                  </Text>
                  <Text variant="number" tone="gain">
                    {f.signed(preview.win)}
                  </Text>
                </View>
                <View style={styles.flex}>
                  <Text variant="caption" tone="muted">
                    {t('machineSheet.ifLose')}
                  </Text>
                  <Text variant="number" tone="alert">
                    {f.signed(preview.lose)}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {data && data.winStreak > 0 && !friendly ? (
          <Text variant="small" tone="muted">
            {t('machineSheet.streak', { count: data.winStreak })}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted">
          {friendly
            ? t('machineSheet.friendly')
            : !member
              ? t('machineSheet.guest')
              : offline || !data
                ? t('machineSheet.offline')
                : t('machineSheet.rewards', { base: offer?.baseReward ?? 25, left: left ?? 0 })}
        </Text>

        <Button
          label={shownBet > 0 ? t('machineSheet.playBet', { amount: f.number(shownBet) }) : t('machineSheet.play')}
          onPress={() => void start()}
          loading={busy}
        />
      </ScrollView>
    </BottomSheet>
  );
}

function LevelRow({ title, desc, right, selected, disabled, onPress }: { title: string; desc: string; right?: string | undefined; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      accessibilityLabel={[title, desc, right].filter(Boolean).join('. ')}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.level,
        {
          backgroundColor: colors.bg,
          borderColor: selected ? colors.text : colors.border,
          borderWidth: selected ? 2 : 1,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.flex}>
        <Text variant="labelStrong">{title}</Text>
        <Text variant="caption" tone="muted">
          {desc}
        </Text>
      </View>
      {right ? <Text variant="number">{right}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingTop: 8 },
  head: { gap: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  levels: { gap: 8 },
  level: { minHeight: 54, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  flex: { flex: 1 },
  bet: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  betValue: { textAlign: 'center', flex: 1 },
});
