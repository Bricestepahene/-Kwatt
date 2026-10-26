/**
 * /regarder · Parties en direct (Autour du damier) : parties publiques en cours des salons et
 * des ligues, les plus regardées d'abord. Regarder ne demande pas de profil.
 */
import type { LiveGame } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { EmptyState, Header, Icon, Screen, SegmentedTabs, Text } from '@/ui';
import { QueryBody } from '../../leagues/components';
import { useLiveGames } from '../api';

type Filter = 'all' | 'dames' | 'ludo';

export function LiveGamesScreen() {
  const { t } = useTranslation('online');
  const [filter, setFilter] = useState<Filter>('all');
  const query = useLiveGames(filter);
  return (
    <Screen
      testID="screen-regarder-liste"
      header={<Header title={t('live.title')} subtitle={t('live.subtitle')} fallback="/" />}
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <SegmentedTabs<Filter>
        accessibilityLabel={t('live.filter')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('live.all') },
          { value: 'dames', label: t('game.dames') },
          { value: 'ludo', label: t('game.ludo') },
        ]}
      />
      <QueryBody query={query}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState icon="tv" title={t('live.emptyTitle')} message={t('live.emptyMessage')} />
          ) : (
            <View style={styles.list}>
              {data.items.map((g) => (
                <LiveRow key={g.id} game={g} />
              ))}
            </View>
          )
        }
      </QueryBody>
    </Screen>
  );
}

function LiveRow({ game }: { game: LiveGame }) {
  const { t } = useTranslation('online');
  const f = useFormat();
  const { colors } = useTheme();
  const names = game.seats.map((s) => s.pseudo).join(game.family === 'dames' ? ' · ' : ', ');
  const where = game.league ? game.league.name : game.room ? game.room.name : t(`game.${game.family}`);
  const progress = game.family === 'dames' ? t('watch.move', { n: Math.floor(game.progress / 2) + 1 }) : t('watch.turn', { n: game.progress });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${names}. ${where}. ${t('watch.viewers', { count: game.spectators })}`}
      onPress={() => router.push(`/regarder/${game.id}` as Href)}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.icon, { backgroundColor: colors.surfaceStrong }]}>
        <Icon name={game.family === 'dames' ? 'play' : 'dice'} size={20} />
      </View>
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {names}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {[where, progress, game.stake > 0 ? t('live.stake', { stake: f.number(game.stake) }) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.viewers}>
        <Icon name="eye" size={16} color={colors.textMuted} />
        <Text variant="smallStrong" tone="muted">
          {f.number(game.spectators)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { minHeight: 64, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  viewers: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
