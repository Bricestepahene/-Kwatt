/**
 * Écran 07 · Accueil du hub (planche Accueil) : « On dit quoi, <pseudo> ? », notifications,
 * cauris, code de salon ou de ligue, espaces de jeu (échelon, niveau, salons ouverts ;
 * Raisonnement en bêta), partie à reprendre, prochain match de ligue, ligue publique du moment.
 */
import { levelProgress } from '@kwatt/domain';
import { brand, ludoSeats, miniBoard } from '@kwatt/design';
import type { HomeView, RatingItem } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { api } from '@/api/client';
import { useFormat } from '@/i18n';
import { useSession } from '@/session';
import { textVariants, useTheme } from '@/theme';
import { Avatar, Badge, Button, CauriBadge, Fabric, Icon, ProgressBar, RankBadge, Screen, SectionLabel, Text, normalizeRoomCode, showToast } from '@/ui';
import { useRatings, useWallet } from '../../dames/api';
import { knockoutStageKey } from '../../leagues/logic';
import { useMyProfile } from '../../profile/api';
import { avatarProps } from '../../profile/looks';
import { useHome } from '../api';
import { bestRating } from '../logic';

export function HomeScreen() {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  const pseudo = useSession((s) => s.data?.user.pseudo) ?? '';
  const home = useHome();
  const wallet = useWallet();
  const ratings = useRatings();
  const profile = useMyProfile();
  const look = avatarProps(profile.data?.look);
  const todo = (home.data?.todo ?? 0) + (home.data?.unread ?? 0);
  const items = ratings.data?.items ?? [];
  const refresh = () => {
    void home.refetch();
    void wallet.refetch();
    void ratings.refetch();
  };

  return (
    <Screen testID="screen-accueil" space="hub" refreshing={home.isRefetching} onRefresh={refresh} gap={14}>
      <View style={styles.top}>
        <Pressable accessibilityRole="link" accessibilityLabel={t('home.profile')} onPress={() => router.push('/profil')} hitSlop={4}>
          <Avatar name={pseudo} size={52} avatar={look.avatar} frame={look.frame ?? 'ndop'} decorative />
        </Pressable>
        <View style={styles.flex}>
          <Text variant="small" tone="muted">
            {t('home.greeting')}
          </Text>
          <Text variant="heading" numberOfLines={1}>
            {t('home.name', { name: pseudo })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={todo > 0 ? t('home.notificationsTodo', { count: todo }) : t('home.notifications')}
          onPress={() => router.push('/notifications')}
          style={[styles.bell, { backgroundColor: colors.surfaceStrong }]}
        >
          <Icon name="bell" size={22} />
          {todo > 0 ? <View style={[styles.dot, { backgroundColor: colors.alert, borderColor: colors.surfaceStrong }]} /> : null}
        </Pressable>
        {wallet.data ? <CauriBadge amount={wallet.data.balance} /> : null}
      </View>

      <CodeEntry />

      {home.data?.resume ? <ResumeCard resume={home.data.resume} /> : null}

      <SectionLabel>{t('home.spaces')}</SectionLabel>
      <SpaceCard game="dames" rating={bestRating(items, 'dames')} rooms={home.data?.openRooms.dames ?? 0} />
      <SpaceCard game="ludo" rating={bestRating(items, 'ludo')} rooms={home.data?.openRooms.ludo ?? 0} />
      <ReasoningCard />

      {home.data?.nextMatch ? <NextMatchCard match={home.data.nextMatch} /> : null}
      {home.data?.publicLeague ? <PublicLeagueCard league={home.data.publicLeague} /> : null}
    </Screen>
  );
}

/** « Code de salon ou de ligue » : salon d'abord, sinon ligue. */
function CodeEntry() {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const code = normalizeRoomCode(raw);
  const go = async () => {
    if (code.length !== 6) {
      showToast(t('home.codeInvalid'), 'alert');
      return;
    }
    setBusy(true);
    try {
      const found = await api.get(`/v1/rooms/by-code/${code}`).then(
        () => `/salon/${code}`,
        () => api.get(`/v1/leagues/by-code/${code}`).then(() => `/ligue/${code}`, () => null),
      );
      if (found) {
        setRaw('');
        router.push(found as Href);
      } else showToast(t('home.codeNotFound'), 'alert');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.codeRow}>
      <TextInput
        accessibilityLabel={t('home.codeLabel')}
        placeholder={t('home.codePlaceholder')}
        placeholderTextColor={colors.textMuted}
        value={raw}
        onChangeText={setRaw}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={9}
        returnKeyType="go"
        onSubmitEditing={() => void go()}
        style={[styles.codeInput, textVariants.body, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
      />
      <Button label={t('home.enter')} variant="tonal" size="lg" onPress={() => void go()} loading={busy} style={styles.enter} />
    </View>
  );
}

function MiniBoard() {
  return (
    <View style={styles.mini} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: 16 }, (_, i) => (
        <View key={i} style={[styles.miniCell, { backgroundColor: (Math.floor(i / 4) + i) % 2 === 0 ? miniBoard.light : miniBoard.dark }]} />
      ))}
    </View>
  );
}

function SpaceCard({ game, rating, rooms }: { game: 'dames' | 'ludo'; rating: RatingItem | null; rooms: number }) {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  const { t: tc } = useTranslation('common');
  const name = t(`home.${game}`);
  const roomsText = t('home.rooms', { count: rooms });
  const bar = game === 'dames' ? colors.action : ludoSeats[3].color;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[name, rating ? `${tc(`rank.${rating.rank}`)} ${tc('rank.level', { level: rating.level })}` : t('home.unranked'), roomsText].join('. ')}
      onPress={() => router.push(`/jouer/${game}` as Href)}
      style={({ pressed }) => [styles.space, { backgroundColor: colors.surface, opacity: pressed ? 0.9 : 1 }]}
    >
      <Fabric name={game === 'dames' ? 'obom' : 'kaba'} style={styles.spaceTop}>
        {game === 'dames' ? (
          <Text variant="display" style={[styles.spaceName, { color: brand.raphia }]}>
            {name}
          </Text>
        ) : (
          <View style={[styles.ludoTag, { backgroundColor: colors.bg }]}>
            <Text variant="display">{name}</Text>
          </View>
        )}
        {game === 'dames' ? <MiniBoard /> : null}
      </Fabric>
      <View style={styles.spaceFoot}>
        {rating ? <RankBadge rank={rating.rank} level={rating.level} /> : <Badge label={t('home.unranked')} />}
        <ProgressBar value={rating ? levelProgress(rating.rating) : 0} color={bar} style={styles.flex} />
        <Text variant="caption" tone="muted">
          {roomsText}
        </Text>
      </View>
    </Pressable>
  );
}

function ReasoningCard() {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${t('home.reasoning')}. ${t('home.reasoningSub')}. ${t('home.beta')}`}
      onPress={() => router.push('/raisonnement')}
      style={({ pressed }) => [styles.reasoning, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.9 : 1 }]}
    >
      <Fabric name="ndop" style={styles.reasoningIcon} />
      <View style={styles.flex}>
        <Text variant="subheading">{t('home.reasoning')}</Text>
        <Text variant="small" tone="muted">
          {t('home.reasoningSub')}
        </Text>
      </View>
      <Text variant="smallStrong" tone="action">
        {t('home.beta')}
      </Text>
    </Pressable>
  );
}

function ResumeCard({ resume }: { resume: NonNullable<HomeView['resume']> }) {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  const title = resume.myTurn ? t('home.resumeYourTurn') : t('home.resumeWaiting');
  const meta = [resume.where, t('home.resumeAgainst', { names: resume.opponents.join(', ') })].filter(Boolean).join(' · ');
  const href = resume.family === 'dames' ? `/dames/partie/${resume.gameId}` : `/ludo/partie/${resume.gameId}`;
  return (
    <View style={[styles.resume, { backgroundColor: colors.surface, borderColor: resume.myTurn ? colors.action : colors.border }]}>
      <Fabric name={resume.family === 'dames' ? 'obom' : 'kaba'} style={styles.band} />
      <View style={[styles.flex, styles.resumeText]}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Button label={t('home.resume')} size="xs" variant={resume.myTurn ? 'primary' : 'outline'} onPress={() => router.push(href as Href)} style={styles.resumeBtn} />
    </View>
  );
}

function NextMatchCard({ match }: { match: NonNullable<HomeView['nextMatch']> }) {
  const { t } = useTranslation('community');
  const f = useFormat();
  const { colors } = useTheme();
  const stage =
    match.stage === 'knockout' && match.level !== null && match.levels !== null
      ? t(`home.stage.${knockoutStageKey(2 ** Math.max(0, match.levels - match.level))}`)
      : t(`home.stage.${match.stage === 'knockout' ? 'round' : match.stage}`, { round: match.round });
  const when = f.date(Date.parse(match.matchAt), 'dayTime');
  const meta = match.opponents.length === 1 ? t('home.matchAgainst', { names: match.opponents[0], when }) : t('home.matchTable', { count: match.opponents.length + 1, when });
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${t('home.nextMatch')}. ${match.leagueName} · ${stage}. ${meta}`}
      onPress={() => router.push(`/ligue/${match.leagueId}/match/${match.matchId}` as Href)}
      style={({ pressed }) => [styles.match, { backgroundColor: colors.surfaceStrong, opacity: pressed ? 0.9 : 1 }]}
    >
      <Badge label={t(`home.${match.game}`)} tone="dark" />
      <View style={styles.flex}>
        <Text variant="labelStrong" numberOfLines={1}>
          {`${match.leagueName} · ${stage}`}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

function PublicLeagueCard({ league }: { league: NonNullable<HomeView['publicLeague']> }) {
  const { t } = useTranslation('community');
  const f = useFormat();
  const { colors } = useTheme();
  const meta =
    league.entry > 0
      ? t('home.publicLeagueMeta', { players: league.players, max: league.maxPlaces, entry: f.caurisAmount(league.entry) })
      : t('home.publicLeagueFree', { players: league.players, max: league.maxPlaces });
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${t('home.publicLeague')}. ${league.name}. ${meta}`}
      onPress={() => router.push(`/ligue-publique/${league.id}` as Href)}
      style={({ pressed }) => [styles.publicLeague, { backgroundColor: colors.surface, opacity: pressed ? 0.9 : 1 }]}
    >
      <Fabric name={league.game === 'dames' ? 'obom' : 'kaba'} style={styles.band} />
      <View style={[styles.flex, styles.resumeText]}>
        <Text variant="caption" tone="muted">
          {t('home.publicLeague')}
        </Text>
        <Text variant="labelStrong" numberOfLines={1}>
          {league.name}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Icon name="chevronRight" size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bell: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, right: 11, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  codeRow: { flexDirection: 'row', gap: 8 },
  codeInput: { flex: 1, height: 52, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14 },
  enter: { height: 52, minWidth: 92 },
  space: { borderRadius: 18, overflow: 'hidden' },
  spaceTop: { height: 92, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  spaceName: { textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 4 },
  ludoTag: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 8 },
  mini: { width: 64, height: 64, flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center' },
  miniCell: { width: 16, height: 16 },
  spaceFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  reasoning: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed' },
  reasoningIcon: { width: 52, height: 52, borderRadius: 10 },
  match: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, minHeight: 60 },
  resume: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, overflow: 'hidden', minHeight: 64 },
  band: { width: 8, alignSelf: 'stretch' },
  resumeText: { paddingHorizontal: 12, paddingVertical: 10 },
  resumeBtn: { marginRight: 12 },
  publicLeague: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, overflow: 'hidden', paddingRight: 12, minHeight: 64 },
});
