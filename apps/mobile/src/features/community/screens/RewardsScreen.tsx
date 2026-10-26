/**
 * Écran 40 · Récompenses (planche Recompenses) : médailles or, argent, bronze sur toghu, série
 * de jours au kwatt (carte rare au 7e jour), quêtes de la semaine avec leur barre et
 * « Récupérer » quand c'est fait, puis les trophées de ligue.
 */
import { brand, fabrics, ludoSeats, medals, miniBoard, type MedalKind } from '@kwatt/design';
import type { QuestView, RewardsView, Trophy } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { Button, Fabric, Header, ProgressBar, Screen, SectionLabel, Text, showToast } from '@/ui';
import { QueryBody } from '../../leagues/components';
import { useClaim, useRewards } from '../api';

function MedalIcon({ kind }: { kind: MedalKind }) {
  const m = medals[kind];
  return (
    <Svg width={40} height={48} viewBox="0 0 40 48" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M10 0h8l4 14h-8zM22 0h8l-4 14h-8z" fill={m.ribbon} />
      <Circle cx={20} cy={30} r={16} fill={m.disc} stroke={m.edge} strokeWidth={2} />
      <Path d="M20 21l3 6 6 .8-4.5 4.2 1.2 6-5.7-3-5.7 3 1.2-6L11 27.8l6-.8z" fill={m.edge} />
    </Svg>
  );
}

function Medals({ medals: m }: { medals: RewardsView['medals'] }) {
  const { t } = useTranslation('community');
  const f = useFormat();
  const tiles: { kind: MedalKind; n: number; label: string }[] = [
    { kind: 'gold', n: m.gold, label: t('rewards.gold') },
    { kind: 'silver', n: m.silver, label: t('rewards.silver') },
    { kind: 'bronze', n: m.bronze, label: t('rewards.bronze') },
  ];
  return (
    <Fabric name="toghu" style={styles.medals}>
      <View accessible accessibilityLabel={t('rewards.medalsA11y', { gold: m.gold, silver: m.silver, bronze: m.bronze })} style={styles.medalRow}>
        {tiles.map((x) => (
          <View key={x.kind} style={[styles.medal, { backgroundColor: fabrics.toghu.base }]}>
            <MedalIcon kind={x.kind} />
            <Text variant="numberLarge" style={{ color: brand.raphia }}>
              {f.number(x.n)}
            </Text>
            <Text variant="small" style={{ color: brand.raphia, opacity: 0.75 }}>
              {x.label}
            </Text>
          </View>
        ))}
      </View>
    </Fabric>
  );
}

function Streak({ streak }: { streak: RewardsView['streak'] }) {
  const { t } = useTranslation('community');
  const { t: ti } = useTranslation('items');
  const { colors } = useTheme();
  const claim = useClaim();
  const sub = !streak.today && streak.length > 0 ? t('rewards.streakToday') : t('rewards.streakNext', { count: streak.daysToReward });
  return (
    <View style={[styles.streak, { backgroundColor: colors.surfaceStrong }]}>
      <View style={styles.streakRow} accessible accessibilityLabel={`${streak.length} ${t('rewards.streak')}. ${sub}`}>
        <Text variant="numberLarge" tone="action" style={styles.streakN}>
          {streak.length}
        </Text>
        <View style={styles.flex}>
          <Text variant="bodyStrong">{t('rewards.streak')}</Text>
          <Text variant="small" tone="muted">
            {sub}
          </Text>
        </View>
      </View>
      {streak.rareChoices > 0 && streak.choices.length > 0 ? (
        <View style={styles.choices}>
          <Text variant="labelStrong">{t('rewards.choose')}</Text>
          <Text variant="small" tone="muted">
            {t('rewards.chooseText', { count: streak.rareChoices })}
          </Text>
          {streak.choices.map((code) => {
            const name = ti(`name.${code}` as 'name.card_table_village');
            return (
              <Button
                key={code}
                label={name}
                variant="outline"
                size="sm"
                loading={claim.isPending && claim.variables?.kind === 'streak' && claim.variables.code === code}
                onPress={() => claim.mutate({ kind: 'streak', code }, { onSuccess: () => showToast(t('rewards.chosen', { name }), 'success') })}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function QuestCard({ quest }: { quest: QuestView }) {
  const { t } = useTranslation('community');
  const { t: tc } = useTranslation('common');
  const { t: ti } = useTranslation('items');
  const { colors } = useTheme();
  const claim = useClaim();
  const title = t(`rewards.quest.${quest.id}` as 'rewards.quest.rafle_3');
  const game = quest.game === 'any' ? t('rewards.gameAny') : t(`home.${quest.game}`);
  const reward = quest.reward.kind === 'cauris' ? t('rewards.rewardCauris', { amount: quest.reward.amount }) : t('rewards.rewardCard', { rarity: tc(`rarity.${quest.reward.rarity}`).toLowerCase() });
  const bar = quest.game === 'ludo' ? ludoSeats[3].color : quest.game === 'dames' ? miniBoard.light : colors.action;
  const meta = quest.legWon && !quest.done ? t('rewards.legWon', { game }) : t('rewards.progress', { game, progress: quest.progress, target: quest.target });
  const doClaim = () =>
    claim.mutate(
      { kind: 'quest', questId: quest.id },
      {
        onSuccess: (r) =>
          showToast(r.card ? t('rewards.gotCard', { name: ti(`name.${r.card}` as 'name.card_table_village') }) : t('rewards.gotCauris', { amount: r.cauris }), 'success'),
      },
    );
  return (
    <View style={[styles.quest, { backgroundColor: colors.surface, borderColor: quest.done && !quest.claimed ? colors.action : colors.border }]}>
      <View style={styles.questTop}>
        <Text variant="bodyStrong" style={styles.flex}>
          {title}
        </Text>
        {quest.claimed ? (
          <Text variant="labelStrong" tone="muted">
            {t('rewards.claimed')}
          </Text>
        ) : quest.done ? (
          <Text variant="labelStrong" style={{ color: colors.gain }}>
            {t('rewards.done')}
          </Text>
        ) : (
          <Text variant="labelStrong" tone="action">
            {reward}
          </Text>
        )}
      </View>
      {quest.done && !quest.claimed ? (
        <Button
          label={quest.reward.kind === 'cauris' ? t('rewards.claimCauris', { amount: quest.reward.amount }) : t('rewards.claimCard')}
          loading={claim.isPending}
          onPress={doClaim}
        />
      ) : (
        <>
          <ProgressBar value={Math.min(1, quest.progress / quest.target)} color={bar} />
          <Text variant="small" tone="muted">
            {meta}
          </Text>
        </>
      )}
    </View>
  );
}

function TrophyCard({ trophy }: { trophy: Trophy }) {
  const { t } = useTranslation('community');
  const f = useFormat();
  const { colors } = useTheme();
  const date = new Intl.DateTimeFormat(f.locale, { month: 'long', year: 'numeric', timeZone: 'Africa/Douala' }).format(new Date(trophy.awardedAt));
  const body = (
    <>
      <Text variant="labelStrong" numberOfLines={2}>
        {trophy.title}
      </Text>
      <Text variant="small" tone="muted">
        {t('rewards.trophyMeta', { place: t(`rewards.trophyKind.${trophy.kind}`), date })}
      </Text>
    </>
  );
  const style = [styles.trophy, { backgroundColor: colors.surface }];
  if (!trophy.leagueId) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${trophy.title}. ${t(`rewards.trophyKind.${trophy.kind}`)} · ${date}`}
      onPress={() => router.push(`/ligue/${trophy.leagueId}` as Href)}
      style={({ pressed }) => [style, { opacity: pressed ? 0.85 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

export function RewardsScreen() {
  const { t } = useTranslation('community');
  const rewards = useRewards();
  return (
    <Screen
      testID="screen-recompenses"
      refreshing={rewards.isRefetching}
      onRefresh={() => void rewards.refetch()}
      gap={14}
      header={<Header title={t('rewards.title')} fallback="/profil" />}
    >
      <QueryBody query={rewards}>
        {(r) => (
          <>
            <Medals medals={r.medals} />
            <Streak streak={r.streak} />
            <SectionLabel>{t('rewards.quests')}</SectionLabel>
            {r.quests.map((q) => (
              <QuestCard key={q.id} quest={q} />
            ))}
            <Text variant="caption" tone="muted">
              {t('rewards.questsEnd')}
            </Text>
            <SectionLabel>{t('rewards.trophies')}</SectionLabel>
            {r.trophies.length === 0 ? (
              <Text variant="small" tone="muted">
                {t('rewards.noTrophies')}
              </Text>
            ) : (
              <View style={styles.trophies}>
                {r.trophies.map((x, i) => (
                  <TrophyCard key={`${x.leagueId ?? x.title}-${i}`} trophy={x} />
                ))}
              </View>
            )}
          </>
        )}
      </QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  medals: { borderRadius: 18, padding: 14 },
  medalRow: { flexDirection: 'row', gap: 10 },
  medal: { flex: 1, alignItems: 'center', gap: 2, borderRadius: 12, paddingVertical: 12 },
  streak: { borderRadius: 14, padding: 14, gap: 12 },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  streakN: { minWidth: 28 },
  choices: { gap: 8 },
  quest: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  questTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trophies: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  trophy: { width: '48.5%', borderRadius: 12, padding: 12, gap: 4, minHeight: 64 },
});
