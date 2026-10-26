/**
 * Écran 41 · Les échelons (planche Echelons) : en-tête sur le tissu du jeu (« Espace Dames »),
 * les six échelons avec leurs niveaux, ce que fait la machine à chaque échelon et ce qu'il
 * débloque ; ton échelon est mis en avant. `?jeu=ludo` ouvre les échelons du Ludo.
 */
import { RANKS, type Rank } from '@kwatt/domain';
import { brand } from '@kwatt/design';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { Fabric, Icon, IconButton, Screen, Text, goBack } from '@/ui';
import { WoodTabs } from '../../dames/FabricHeader';
import { useRatings } from '../../dames/api';
import { bestRating, rankIndex } from '../logic';

type Game = 'dames' | 'ludo';

function RankRow({ rank, game, state, level }: { rank: Rank; game: Game; state: 'done' | 'current' | 'next'; level: number | null }) {
  const { t } = useTranslation('community');
  const { t: tc } = useTranslation('common');
  const { colors } = useTheme();
  const name = tc(`rank.${rank.id}`);
  const levels = rank.maxLevel === null ? t('ranks.levelsOpen', { min: rank.minLevel }) : t('ranks.levels', { min: rank.minLevel, max: rank.maxLevel });
  const machine = t(`${game === 'ludo' ? 'ranks.machineLudo' : 'ranks.machine'}.${rank.id}`);
  const unlocks = rank.unlocks.map((u) => t(`ranks.${u}` as 'ranks.unlock.basic_board')).join(' · ');
  const current = state === 'current';
  return (
    <View
      accessible
      accessibilityLabel={[current ? t('ranks.you', { rank: name }) : name, levels, machine, unlocks, t(`ranks.${state}`)].join('. ')}
      style={[
        styles.row,
        { backgroundColor: current ? colors.surfaceStrong : colors.surface, borderColor: current ? colors.action : colors.border, opacity: state === 'next' ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.idx, { backgroundColor: state === 'done' ? colors.gain : current ? colors.action : colors.bg }]}>
        {state === 'done' ? (
          <Icon name="check" size={18} color={colors.bg} strokeWidth={3} />
        ) : (
          <Text variant="labelStrong" style={{ color: current ? colors.onAction : colors.text }}>
            {rank.index + 1}
          </Text>
        )}
      </View>
      <View style={styles.flex}>
        <View style={styles.top}>
          <Text variant="subheading" style={styles.flex} numberOfLines={1}>
            {current ? t('ranks.you', { rank: name }) : name}
          </Text>
          <Text variant="caption" tone="muted">
            {levels}
          </Text>
        </View>
        {current && level !== null ? (
          <Text variant="small" tone="action">
            {t('ranks.position', { rank: name, level })}
          </Text>
        ) : null}
        <Text variant="small" tone="muted">
          {machine}
        </Text>
        <Text variant="smallStrong" tone="action">
          {unlocks}
        </Text>
      </View>
    </View>
  );
}

export function RanksScreen() {
  const { t } = useTranslation('community');
  const { t: tc } = useTranslation('common');
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ jeu?: string }>();
  const [game, setGame] = useState<Game>(params.jeu === 'ludo' ? 'ludo' : 'dames');
  const ratings = useRatings();
  const best = bestRating(ratings.data?.items ?? [], game);
  const current = best ? rankIndex(best.rating) : -1;

  return (
    <Screen testID="screen-echelons" padded={false} refreshing={ratings.isRefetching} onRefresh={() => void ratings.refetch()}>
      <Fabric name={game === 'ludo' ? 'kaba' : 'obom'} style={styles.head}>
        <View style={styles.headRow}>
          <IconButton icon="back" tone="bg" accessibilityLabel={tc('action.back')} onPress={() => goBack('/profil')} />
          <View style={[styles.flex, game === 'ludo' && [styles.veil, { backgroundColor: colors.overlay }]]}>
            <Text variant="section" style={{ color: brand.raphia }} numberOfLines={1}>
              {t('ranks.space', { game: t(`home.${game}`) })}
            </Text>
            <Text variant="heading" accessibilityRole="header" style={{ color: brand.raphia }}>
              {t('ranks.title')}
            </Text>
          </View>
        </View>
        <WoodTabs<Game>
          accessibilityLabel={t('ranks.title')}
          value={game}
          onChange={setGame}
          options={[
            { value: 'dames', label: t('home.dames') },
            { value: 'ludo', label: t('home.ludo') },
          ]}
        />
      </Fabric>
      <View style={styles.body}>
        <Text variant="body" tone="muted">
          {t('ranks.lead')}
        </Text>
        {best === null ? (
          <Text variant="smallStrong" tone="muted">
            {t('ranks.notRanked')}
          </Text>
        ) : null}
        {RANKS.map((r) => (
          <RankRow key={r.id} rank={r} game={game} state={r.index < current ? 'done' : r.index === current ? 'current' : 'next'} level={best?.level ?? null} />
        ))}
        <View style={[styles.note, { backgroundColor: colors.surfaceStrong }]}>
          <Text variant="small">{t('ranks.note')}</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  head: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, gap: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  veil: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, gap: 10 },
  row: { flexDirection: 'row', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  idx: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  note: { borderRadius: 14, padding: 14, marginTop: 6 },
});
