/**
 * Écran 27 · Ligues (planche Ligues) : « Créer », code d'une ligue privée, onglets
 * Mes ligues · Publiques, filtre par jeu, puis les cartes des ligues avec ta place
 * (ou les places restantes d'une ligue publique).
 */
import type { LeagueCard } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useFormat } from '@/i18n';
import { textVariants, useTheme } from '@/theme';
import { Button, Chip, EmptyState, Fabric, SegmentedTabs, Screen, Text, formatRoomCode } from '@/ui';
import { useLeagues } from '../api';
import { QueryBody, fabricOf } from '../components';
import { daysHours, leagueCodeFrom, leagueHref } from '../logic';

type Scope = 'mine' | 'public';
type GameFilter = 'all' | 'dames' | 'ludo';

function LeagueCardView({ league, scope }: { league: LeagueCard; scope: Scope }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const { colors } = useTheme();
  const kind =
    league.status === 'finished' || league.status === 'cancelled'
      ? t(`card.kind.${league.status}`)
      : league.access === 'public'
        ? t(`card.kind.public_${league.status}`)
        : t(`card.kind.private_${league.format}`);
  const closesIn = league.registrationClosesAt ? daysHours(Date.parse(league.registrationClosesAt) - Date.now()) : null;
  const meta =
    league.access === 'public' && league.status === 'registration'
      ? t('card.meta.registration', { players: league.players, max: league.maxPlaces, entry: f.caurisAmount(league.entry), days: closesIn?.days ?? 0 })
      : league.status === 'registration'
        ? t('card.meta.waiting', { count: league.players })
        : league.format === 'cup'
          ? t('card.meta.cup', { count: league.players, groups: league.groups ?? 1 })
          : t(league.game === 'ludo' ? 'card.meta.ludo' : league.doubleRound ? 'card.meta.double' : 'card.meta.single', {
              count: league.players,
              round: league.currentRound,
              total: league.totalRounds,
            });
  const showPlace = scope === 'mine' && league.myPosition !== null;
  const big = showPlace ? t('place', { count: league.myPosition ?? 0, ordinal: true }) : scope === 'public' ? f.number(league.placesLeft) : '—';
  const small = showPlace ? t(league.format === 'cup' ? 'card.placeGroup' : 'card.myPlace') : scope === 'public' ? t('card.places', { count: league.placesLeft }) : '';
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${league.name}. ${kind}. ${meta}. ${big} ${small}`}
      onPress={() => router.push(leagueHref(league) as Href)}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      <Fabric name={fabricOf(league.game)} style={styles.stripe} />
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <View style={[styles.gameTag, { backgroundColor: colors.bg }]}>
            <Text variant="badge">{t(`game.${league.game}`)}</Text>
          </View>
          <Text variant="caption" tone="muted" style={styles.kind} numberOfLines={1}>
            {kind}
          </Text>
        </View>
        <Text variant="bodyStrong" numberOfLines={2}>
          {league.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {meta}
        </Text>
      </View>
      <View style={styles.cardPos}>
        <Text variant="number" tone="action">
          {big}
        </Text>
        <Text variant="caption" tone="muted">
          {small}
        </Text>
      </View>
    </Pressable>
  );
}

export function LeaguesScreen() {
  const { t } = useTranslation('leagues');
  const { colors } = useTheme();
  const [scope, setScope] = useState<Scope>('mine');
  const [game, setGame] = useState<GameFilter>('all');
  const [code, setCode] = useState('');
  const query = useLeagues(scope, game);
  const joinCode = leagueCodeFrom(code);

  return (
    <Screen
      testID="screen-ligues"
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
      header={
        <View style={styles.titleRow}>
          <Text variant="display" accessibilityRole="header">
            {t('list.title')}
          </Text>
          <Button label={t('list.create')} icon="plus" size="sm" onPress={() => router.push('/ligue/nouvelle' as Href)} />
        </View>
      }
    >
      <View style={styles.codeRow}>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder={t('list.codePlaceholder')}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.action}
          accessibilityLabel={t('list.codeLabel')}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          style={[styles.codeField, textVariants.body, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
          onSubmitEditing={() => joinCode && router.push(`/ligue/${joinCode}` as Href)}
        />
        <Button
          label={t('list.join')}
          variant="tonal"
          size="sm"
          disabled={!joinCode}
          accessibilityLabel={joinCode ? t('list.joinCode', { code: formatRoomCode(joinCode) }) : t('list.join')}
          onPress={() => joinCode && router.push(`/ligue/${joinCode}` as Href)}
        />
      </View>
      <SegmentedTabs<Scope>
        accessibilityLabel={t('list.scopeLabel')}
        value={scope}
        onChange={setScope}
        options={[
          { value: 'mine', label: t('list.mine') },
          { value: 'public', label: t('list.public') },
        ]}
      />
      <View style={styles.filters} accessibilityLabel={t('list.filterLabel')}>
        {(['all', 'dames', 'ludo'] as const).map((g) => (
          <Chip key={g} label={t(`list.filter.${g}`)} selected={game === g} onPress={() => setGame(g)} />
        ))}
      </View>
      <QueryBody query={query}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              icon="trophy"
              title={t(scope === 'mine' ? 'list.emptyMine' : 'list.emptyPublic')}
              message={t(scope === 'mine' ? 'list.emptyMineBody' : 'list.emptyPublicBody')}
              {...(scope === 'mine' ? { action: { label: t('list.create'), onPress: () => router.push('/ligue/nouvelle' as Href) } } : {})}
            />
          ) : (
            <View style={styles.list}>
              {data.items.map((l) => (
                <LeagueCardView key={l.id} league={l} scope={scope} />
              ))}
            </View>
          )
        }
      </QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeField: { flex: 1, minWidth: 0, height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14 },
  filters: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  list: { gap: 10 },
  card: { flexDirection: 'row', borderRadius: 16, overflow: 'hidden', minHeight: 88 },
  stripe: { width: 10 },
  cardBody: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gameTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 },
  kind: { flexShrink: 1 },
  cardPos: { paddingVertical: 12, paddingHorizontal: 14, alignItems: 'flex-end', justifyContent: 'center', gap: 2 },
});
