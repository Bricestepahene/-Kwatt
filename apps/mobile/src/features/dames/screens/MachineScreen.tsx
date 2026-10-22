/**
 * Écran 15 · Défi et pari contre la machine (planche DefiMachine).
 * Cinq difficultés (cote = 0,9 ÷ p, Fon verrouillé avant Chef), pari par pas de 50 sous le
 * plafond (C2 betCap), aperçu « Si tu gagnes / Si tu perds », série ×1,5, rappel des 10
 * parties récompensées. Sans réseau : pas de pari, offres calculées sur l'appareil.
 * Sans pari : partie locale (moteur dans l'appli). Avec pari : POST /v1/games/machine (C3),
 * puis la partie en ligne.
 */
import type { MachineDifficultyOffer } from '@kwatt/protocol';
import type { Variant } from '@kwatt/rules-dames';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFormat } from '../../../i18n';
import { useIsOffline } from '../../../offline';
import { useSession } from '../../../session';
import { useTheme } from '../../../theme';
import { Button, IconButton, Screen, SectionLabel, Skeleton, Text, goBack, showToast } from '../../../ui';
import { useLocalSnapshot } from '../../profile/snapshot';
import { createMachineGame, useMachineOffers, useRatings, useWallet } from '../api';
import { FabricHeader, OnWood } from '../FabricHeader';
import { startLocalDames } from '../machineGame';
import { betPreview, initialBet, localOffers, oddsLabel, stepBet } from '../offers';
import { isDamesVariant, useDamesVariant } from '../variantPref';

export function MachineScreen() {
  const { t } = useTranslation('dames');
  const { t: tc } = useTranslation('common');
  const f = useFormat();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ variant?: string }>();
  const [stored] = useDamesVariant();
  const variant: Variant = isDamesVariant(params.variant) ? params.variant : stored;
  const offline = useIsOffline();
  const user = useSession((s) => s.data?.user ?? null);

  const offersQ = useMachineOffers('dames', variant);
  const snapshot = useLocalSnapshot(`dames.offers.${variant}`, offersQ.data);
  const ratings = useRatings();
  const ratingSnap = useLocalSnapshot('dames.ratings', ratings.data);
  const wallet = useWallet();

  const offers = useMemo(() => {
    if (offersQ.data) return offersQ.data;
    const local = snapshot?.data;
    if (offersQ.isError || offline) {
      const rating = (ratings.data ?? ratingSnap?.data)?.items.find((i) => i.variant === variant)?.rating ?? local?.rating ?? null;
      return localOffers(rating, local);
    }
    return null;
  }, [offersQ.data, offersQ.isError, offline, snapshot, ratings.data, ratingSnap, variant]);

  const [picked, setPicked] = useState<MachineDifficultyOffer['id'] | null>(null);
  const [bet, setBet] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  const canBet = !offline && Boolean(offersQ.data) && (offers?.betCap ?? 0) > 0;
  const cap = canBet ? (offers?.betCap ?? 0) : 0;
  useEffect(() => {
    if (bet === null && offersQ.data) setBet(initialBet(cap));
  }, [offersQ.data, cap, bet]);
  const currentBet = canBet ? Math.min(bet ?? 0, cap) : 0;

  const auto = offers?.auto.difficulty ?? 'ton_niveau';
  const selectedId = picked ?? auto;
  const selected = offers?.difficulties.find((d) => d.id === selectedId) ?? null;
  const rankLabel = offers ? tc(`rank.${offers.rank}`) : '';
  const nameOf = (d: MachineDifficultyOffer) => (d.id === 'ton_niveau' && rankLabel ? rankLabel : t(`difficulty.${d.id}`));
  const preview = selected ? betPreview(selected, currentBet, offers?.winStreak ?? 0) : null;
  const decimal = f.language === 'fr' ? ',' : '.';
  const dailyDone = (offers?.rewardedToday ?? 0) >= 10;

  const start = async () => {
    if (!selected || !offers) return;
    const mode = picked === null || picked === auto ? 'auto' : 'chosen';
    if (currentBet > 0) {
      setStarting(true);
      try {
        const { gameId } = await createMachineGame({ family: 'dames', variant, difficulty: selected.id, mode, bet: currentBet });
        router.replace(`/dames/partie/${encodeURIComponent(gameId)}` as Href);
      } catch {
        showToast(t('machine.betUnavailable'), 'alert');
      } finally {
        setStarting(false);
      }
      return;
    }
    const id = startLocalDames({
      variant,
      difficulty: selected.id,
      mode,
      machineRating: selected.machineRating,
      player: { userId: user?.id ?? null, name: user?.pseudo ?? t('game.you') },
      machineName: t('difficulty.machineName', { level: nameOf(selected) }),
    });
    router.replace(`/dames/partie/${encodeURIComponent(id)}` as Href);
  };

  return (
    <Screen
      padded={false}
      gap={0}
      testID="screen-machine"
      footer={
        offers ? (
          <>
            <Button
              label={currentBet > 0 ? t('machine.ctaBet', { amount: f.caurisAmount(currentBet) }) : t('machine.ctaPlay')}
              onPress={() => void start()}
              loading={starting}
              disabled={!selected?.unlocked}
              testID="machine-start"
            />
            <Text variant="caption" tone="muted" align="center">
              {dailyDone ? t('machine.dailyDone') : t('machine.footer', { base: selected?.baseReward ?? 25 })}
            </Text>
          </>
        ) : undefined
      }
    >
      <FabricHeader style={styles.header}>
        <View style={styles.headerRow}>
          <IconButton icon="back" tone="bg" accessibilityLabel={tc('action.back')} onPress={() => goBack('/jouer/dames')} />
          <View style={styles.flex}>
            <OnWood variant="section" style={styles.eyebrow} numberOfLines={1}>
              {t('machine.eyebrow')}
            </OnWood>
            <OnWood variant="heading" numberOfLines={2}>
              {t('machine.title')}
            </OnWood>
          </View>
        </View>
      </FabricHeader>

      <View style={styles.body}>
        <SectionLabel>{t('machine.difficultyLabel')}</SectionLabel>
        {!offers ? (
          <View style={styles.levels}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={54} radius={12} />
            ))}
          </View>
        ) : (
          <View style={styles.levels} accessibilityRole="radiogroup">
            {offers.difficulties.map((d) => {
              const on = d.id === selectedId;
              const odds = oddsLabel(d.oddsHundredths, decimal);
              return (
                <Pressable
                  key={d.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: !d.unlocked }}
                  accessibilityLabel={`${d.unlocked ? nameOf(d) : t('difficulty.locked', { name: nameOf(d) })}, ${t(`difficulty.desc.${d.id}`)}, ${t('machine.oddsA11y', { odds })}`}
                  disabled={!d.unlocked}
                  onPress={() => setPicked(d.id)}
                  style={({ pressed }) => [
                    styles.level,
                    {
                      backgroundColor: colors.surface,
                      borderColor: on ? colors.text : colors.border,
                      borderWidth: on ? 2 : 1,
                      opacity: !d.unlocked ? 0.5 : pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <View style={styles.flex}>
                    <Text variant="labelStrong" numberOfLines={1}>
                      {d.unlocked ? nameOf(d) : t('difficulty.locked', { name: nameOf(d) })}
                      {d.id === auto ? (
                        <Text variant="caption" tone="muted">
                          {'  '}
                          {t('difficulty.auto')}
                        </Text>
                      ) : null}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {d.unlocked ? t(`difficulty.desc.${d.id}`) : t('difficulty.lockedDesc')}
                    </Text>
                  </View>
                  <Text variant="number" tone={d.oddsHundredths >= 300 ? 'action' : 'default'} style={styles.odds}>
                    {t('machine.odds', { odds })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.betHead}>
          <SectionLabel>{t('machine.betLabel')}</SectionLabel>
          {wallet.data ? (
            <Text variant="caption" tone="muted">
              {t('machine.balance', { amount: f.caurisAmount(wallet.data.balance) })}
            </Text>
          ) : null}
        </View>
        <View style={styles.stepper}>
          <StepButton label="−" a11y={t('machine.betDecrease')} disabled={!canBet || currentBet <= 0} onPress={() => setBet(stepBet(currentBet, -1, cap))} />
          <View style={[styles.betValue, { backgroundColor: colors.surface }]} accessible accessibilityLabel={t('machine.betA11y', { amount: f.cauris(currentBet) })}>
            <Text variant="number" tone="action" style={styles.betNumber}>
              {f.caurisAmount(currentBet)}
            </Text>
            <Text variant="caption" tone="muted">
              {t('machine.betUnit')}
            </Text>
          </View>
          <StepButton label="+" a11y={t('machine.betIncrease')} disabled={!canBet || currentBet >= cap} onPress={() => setBet(stepBet(currentBet, 1, cap))} />
        </View>
        {offline || offersQ.isError ? (
          <Text variant="caption" tone="alert">
            {t('machine.offline')}
          </Text>
        ) : offers && offers.betCap === 0 ? (
          <Text variant="caption" tone="muted">
            {t('machine.noBetRight')}
          </Text>
        ) : null}

        {preview && selected ? (
          <View style={styles.previews}>
            <View style={[styles.preview, { backgroundColor: colors.gainSoft }]}>
              <Text variant="caption" style={{ color: colors.gainSoftText }}>
                {t('machine.ifWin')}
              </Text>
              <Text variant="number" tone="gain">
                {f.signed(preview.ifWin)}
              </Text>
              <Text variant="caption" style={{ color: colors.gainSoftText }}>
                {currentBet > 0 ? t('machine.ifWinDetail', { base: preview.base }) : t('machine.ifWinNoBet', { base: preview.base })}
              </Text>
            </View>
            <View style={[styles.preview, { backgroundColor: colors.lossSoft }]}>
              <Text variant="caption" style={{ color: colors.lossSoftText }}>
                {t('machine.ifLose')}
              </Text>
              <Text variant="number" tone="alert">
                {f.signed(preview.ifLoss)}
              </Text>
              <Text variant="caption" style={{ color: colors.lossSoftText }}>
                {currentBet > 0 ? t('machine.ifLoseDetail') : t('machine.ifLoseNoBet')}
              </Text>
            </View>
          </View>
        ) : null}

        {offers ? (
          <View style={[styles.streak, { backgroundColor: colors.surfaceStrong }]}>
            <Text variant="subheading" tone="action">
              {f.language === 'fr' ? '×1,5' : '×1.5'}
            </Text>
            <Text variant="caption" style={styles.flex}>
              {preview?.streakNext
                ? t('machine.streakReady', { count: offers.winStreak })
                : offers.winStreak > 0
                  ? t('machine.streak', { count: offers.winStreak % 3 })
                  : t('machine.streakNone')}
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function StepButton({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text variant="heading">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: 16, paddingBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyebrow: { fontSize: 11, letterSpacing: 1.3 },
  flex: { flex: 1 },
  body: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8, gap: 12 },
  levels: { gap: 6 },
  level: { minHeight: 54, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 14 },
  odds: { fontSize: 15 },
  betHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  betValue: { flex: 1, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  betNumber: { fontSize: 20 },
  previews: { flexDirection: 'row', gap: 8 },
  preview: { flex: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
});
