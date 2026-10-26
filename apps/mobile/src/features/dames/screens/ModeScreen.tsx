/**
 * Écran 14 · Dames : choisir un mode (planche ModeDames).
 * En-tête de bois : sélecteur d'espace, « Espace Dames · 10×10 », « Comment on joue ? »,
 * échelon et force de la variante (C1). Cartes de mode : machine (difficulté auto), salon,
 * défi avec mise, ligues, problème du jour (série, +10). Sélecteur 10×10 / 8×8, règle de la
 * variante, liens « Règles » et « Voir le plateau ». Mémorise lastSpace = dames (layout).
 */
import { START_RATING, levelFromRating, rankForRating } from '@kwatt/domain';
import { initialState } from '@kwatt/rules-dames';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useLocalSnapshot } from '../../profile/snapshot';
import { useFormat } from '../../../i18n';
import { usePendingOfflineCount } from '../../../offline';
import { useAccessSession } from '../../../session';
import { useTheme } from '../../../theme';
import { BottomSheet, CauriIcon, Icon, Screen, Text, type IconName } from '../../../ui';
import { useDailyPuzzle, useMachineOffers, useRatings } from '../api';
import { DamesBoard } from '../board/DamesBoard';
import { FabricHeader, OnWood, WoodBadge, WoodOverlay, WoodTabs } from '../FabricHeader';
import { savedLocalDames } from '../machineGame';
import { useDamesVariant } from '../variantPref';

type SpaceTab = 'dames' | 'ludo' | 'raisonnement';

export function ModeScreen() {
  const { t } = useTranslation('dames');
  const { t: tc } = useTranslation('common');
  const f = useFormat();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const access = useAccessSession();
  const member = access.status === 'member';
  const [variant, setVariant] = useDamesVariant();
  const [preview, setPreview] = useState(false);
  const [resume, setResume] = useState<{ id: string } | null>(null);
  const pending = usePendingOfflineCount();

  const ratings = useRatings(member);
  const ratingsLocal = useLocalSnapshot(member ? 'dames.ratings' : null, ratings.data);
  const offers = useMachineOffers('dames', variant, 1, member);
  const puzzle = useDailyPuzzle(variant, member);

  useFocusEffect(
    useCallback(() => {
      void savedLocalDames().then(setResume);
    }, []),
  );

  const items = (ratings.data ?? ratingsLocal?.data)?.items ?? [];
  const mine = items.find((i) => i.variant === variant);
  const rating = mine?.rating ?? START_RATING;
  const level = mine?.level ?? levelFromRating(rating);
  const rank = mine?.rank ?? rankForRating(rating).id;
  const rankLabel = tc(`rank.${rank}`);
  const vShort = t(`variant.${variant}.short`);
  const forceLine = !mine
    ? t('mode.forceNew', { variant: vShort, rating: f.number(START_RATING) })
    : !ratings.data && ratingsLocal
      ? t('mode.forceOffline', { variant: vShort, rating: f.number(rating) })
      : t('mode.force', { variant: vShort, rating: f.number(rating) });

  const auto = offers.data?.auto.difficulty ?? 'ton_niveau';
  const autoLabel = auto === 'ton_niveau' ? rankLabel : t(`difficulty.${auto}`);
  const daily = puzzle.data;

  const onSpace = (s: SpaceTab) => {
    if (s === 'ludo') router.replace('/jouer/ludo');
    else if (s === 'raisonnement') router.push('/raisonnement');
  };

  const previewSize = Math.min(width - 40, 420);

  return (
    <Screen padded={false} edges={['top']} gap={0} testID="screen-modeDames">
      <FabricHeader>
        <WoodTabs<SpaceTab>
          accessibilityLabel={t('space.label')}
          value="dames"
          onChange={onSpace}
          options={[
            { value: 'dames', label: t('space.dames') },
            { value: 'ludo', label: t('space.ludo') },
            { value: 'raisonnement', label: t('space.raisonnement') },
          ]}
        />
        <View style={styles.titles}>
          <OnWood variant="section" style={styles.eyebrow}>
            {t('mode.eyebrow', { variant: vShort })}
          </OnWood>
          <OnWood variant="display">{t('mode.title')}</OnWood>
        </View>
        <WoodOverlay>
          <WoodBadge label={tc('rank.badge', { rank: rankLabel, level })} accessibilityLabel={tc('rank.a11y', { rank: rankLabel, level })} />
          <OnWood variant="small" style={styles.flex} numberOfLines={2}>
            {forceLine}
          </OnWood>
        </WoodOverlay>
      </FabricHeader>

      <View style={styles.body}>
        {pending > 0 ? (
          <Text variant="small" tone="muted">
            {t('offline.pending', { count: pending })}
          </Text>
        ) : null}
        <ModeCard
          icon="machine"
          title={t('mode.machine.title')}
          desc={resume ? t('mode.machine.resume') : t('mode.machine.desc', { level: autoLabel })}
          highlighted={Boolean(resume)}
          onPress={() =>
            resume
              ? router.push(`/dames/partie/${encodeURIComponent(resume.id)}` as Href)
              : router.push({ pathname: '/dames/machine', params: { variant } } as unknown as Href)
          }
        />
        <ModeCard icon="friends" title={t('mode.salon.title')} desc={t('mode.salon.desc')} onPress={() => router.push('/salon/nouveau?jeu=dames' as Href)} />
        <ModeCard
          icon="cauri"
          title={t('mode.defi.title')}
          desc={access.isAdult ? t('mode.defi.desc') : t('mode.defi.adult')}
          disabled={!access.isAdult}
          onPress={() => router.push('/defi/nouveau?jeu=dames' as Href)}
        />
        <ModeCard icon="trophy" title={t('mode.ligues.title')} desc={t('mode.ligues.desc')} onPress={() => router.push('/ligues?jeu=dames' as Href)} />
        <ModeCard
          icon="help"
          title={t('mode.probleme.title')}
          desc={
            daily?.solved
              ? t('mode.probleme.solved', { count: daily.streak })
              : daily && daily.streak > 0
                ? t('mode.probleme.desc', { count: daily.streak, reward: daily.reward })
                : t('mode.probleme.descNew', { reward: daily?.reward ?? 10 })
          }
          highlighted={!daily?.solved && !resume}
          onPress={() => router.push({ pathname: '/dames/probleme-du-jour', params: { variant } } as unknown as Href)}
        />

        <View accessibilityRole="radiogroup" accessibilityLabel={t('variant.pick')} style={styles.variants}>
          {(['dames10', 'dames8'] as const).map((v) => {
            const on = v === variant;
            return (
              <Pressable
                key={v}
                accessibilityRole="radio"
                accessibilityState={{ checked: on, selected: on }}
                onPress={() => setVariant(v)}
                style={({ pressed }) => [
                  styles.variant,
                  { backgroundColor: colors.surface, borderColor: on ? colors.text : colors.border, borderWidth: on ? 2 : 1, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <MiniGrid size={v === 'dames10' ? 10 : 8} />
                <View style={styles.flexShrink}>
                  <Text variant="smallStrong" numberOfLines={1}>
                    {t(`variant.${v}.name`)}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {t(`variant.${v}.desc`)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.ruleRow}>
          <Text variant="caption" tone="muted" style={styles.flex}>
            {t(`variant.${variant}.rule`)}
          </Text>
          <Pressable accessibilityRole="link" hitSlop={12} onPress={() => router.push(`/regles/${variant === 'dames8' ? 'dames8' : 'dames'}` as Href)}>
            <Text variant="smallStrong" tone="action">
              {t('mode.rules')}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="link" hitSlop={12} onPress={() => setPreview(true)}>
            <Text variant="smallStrong" tone="action">
              {t('mode.preview')}
            </Text>
          </Pressable>
        </View>
      </View>

      <BottomSheet visible={preview} onClose={() => setPreview(false)} accessibilityLabel={t('mode.previewTitle', { variant: vShort })}>
        <Text variant="subheading">{t('mode.previewTitle', { variant: vShort })}</Text>
        <View style={styles.previewBoard}>
          <DamesBoard state={initialState(variant)} size={previewSize} interactive={false} accessibilityLabel={t('board.labelVariant', { size: variant === 'dames8' ? 8 : 10 })} />
        </View>
        <Text variant="small" tone="muted">
          {t(`variant.${variant}.rule`)}
        </Text>
      </BottomSheet>
    </Screen>
  );
}

function ModeCard({
  icon,
  title,
  desc,
  onPress,
  highlighted = false,
  disabled = false,
}: {
  icon: IconName | 'cauri';
  title: string;
  desc: string;
  onPress: () => void;
  highlighted?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${desc}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.mode,
        { backgroundColor: colors.surface, opacity: disabled ? 0.55 : pressed ? 0.85 : 1 },
        highlighted ? { borderWidth: 1, borderColor: colors.action } : null,
      ]}
    >
      <View style={[styles.modeIcon, { backgroundColor: colors.surfaceStrong }]}>
        {icon === 'cauri' ? <CauriIcon size={24} /> : <Icon name={icon} size={24} color={colors.text} />}
      </View>
      <View style={styles.modeText}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" tone="muted">
          {desc}
        </Text>
      </View>
    </Pressable>
  );
}

/** Petit damier de la variante (sélecteur 10×10 / 8×8). */
function MiniGrid({ size }: { size: number }) {
  const { colors } = useTheme();
  const cell = 30 / size;
  return (
    <View style={[styles.mini, { backgroundColor: colors.board.light }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: size * size }, (_, i) => {
        const r = Math.floor(i / size);
        const c = i % size;
        return (r + c) % 2 === 1 ? (
          <View key={i} style={{ position: 'absolute', left: c * cell, top: r * cell, width: cell, height: cell, backgroundColor: colors.board.dark }} />
        ) : null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  titles: { gap: 4 },
  eyebrow: { letterSpacing: 1.7 },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1, gap: 1 },
  body: { paddingHorizontal: 20, paddingVertical: 16, gap: 10 },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 14, minHeight: 48 },
  modeIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  modeText: { flex: 1, gap: 2 },
  variants: { flexDirection: 'row', gap: 8, marginTop: 6 },
  variant: { flex: 1, minHeight: 58, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  mini: { width: 30, height: 30, borderRadius: 4, overflow: 'hidden' },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  previewBoard: { alignItems: 'center', paddingVertical: 8 },
});
