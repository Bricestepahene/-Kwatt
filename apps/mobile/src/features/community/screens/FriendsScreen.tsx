/**
 * Écran 12 · Mes amis (planche Amis) : recherche de pseudo, « Inviter par lien », onglets
 * Amis · Demandes, amis en ligne (disponible, en partie, spectateur) avec Défier ou Regarder,
 * amis hors ligne (« vu il y a 3 h »), demandes reçues avec Accepter, demandes envoyées.
 * `?onglet=demandes` ouvre directement les demandes (notification « veut t'ajouter »).
 */
import type { Friend, FriendRequestView, FriendSearchItem, PlayerLook } from '@kwatt/protocol';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { textVariants, useTheme } from '@/theme';
import { BottomSheet, Button, ConfirmSheet, EmptyState, Header, Icon, ListItem, Screen, SectionLabel, SegmentedTabs, Text, showToast } from '@/ui';
import { PlayerAvatar, QueryBody } from '../../leagues/components';
import { useFriendAction, useFriendRequests, useFriendSearch, useFriends, useMyFriendCode } from '../api';
import { friendLink, friendStatus, lastSeen } from '../logic';

type Tab = 'friends' | 'requests';

function Person({
  pseudo,
  avatar,
  ring,
  line,
  lineTone = 'muted',
  right,
  boxed,
  onPress,
  label,
}: {
  pseudo: string;
  avatar: PlayerLook | null;
  ring?: string | undefined;
  line: string;
  lineTone?: 'muted' | 'gain';
  right?: React.ReactNode;
  boxed: boolean;
  onPress?: () => void;
  label?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.person, boxed && { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={label ?? pseudo} onPress={onPress} disabled={!onPress} style={styles.who}>
        <PlayerAvatar player={{ userId: '', pseudo, avatar }} size={48} {...(ring ? { ringColor: ring } : {})} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1} tone={boxed ? 'default' : 'muted'} style={boxed ? undefined : { color: colors.text, opacity: 0.8 }}>
            {pseudo}
          </Text>
          <Text variant="small" tone={lineTone} numberOfLines={1}>
            {line}
          </Text>
        </View>
      </Pressable>
      {right}
    </View>
  );
}

function FriendRow({ friend, onMore }: { friend: Friend; onMore: (f: Friend) => void }) {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  const s = friendStatus(friend);
  const name = friend.pseudo;
  let line: string;
  let right: React.ReactNode = null;
  if (s.kind === 'playing') {
    line = s.family ? t('friends.playing', { game: t(`home.${s.family}`), move: s.move }) : t('friends.playingGame');
    if (s.watchable && s.gameId) right = <Button label={t('friends.watch')} size="sm" variant="outline" onPress={() => router.push(`/regarder/${s.gameId}` as Href)} />;
  } else if (s.kind === 'watching') {
    line = t('friends.watching');
  } else if (s.kind === 'available') {
    line = t('friends.available');
    right = <Button label={t('friends.challenge')} size="sm" onPress={() => router.push({ pathname: '/defi/nouveau', params: { userId: friend.userId, name } } as Href)} />;
  } else {
    const seen = lastSeen(s.lastSeenAt, Date.now());
    line = t(`friends.seen.${seen.key}`, { count: seen.count });
  }
  return (
    <Person
      pseudo={name}
      avatar={friend.avatar}
      ring={friend.online ? colors.gain : undefined}
      line={line}
      lineTone={s.kind === 'available' ? 'gain' : 'muted'}
      boxed={friend.online}
      right={right}
      onPress={() => onMore(friend)}
      label={`${t('friends.more', { name })}. ${line}`}
    />
  );
}

function RequestRow({ r }: { r: FriendRequestView }) {
  const { t } = useTranslation('community');
  const action = useFriendAction();
  const meta =
    r.direction === 'outgoing'
      ? t('friends.waiting')
      : [r.quarter, r.gamesTogether > 0 ? t('friends.requestMetaGames', { count: r.gamesTogether }) : null, r.gamesTogether > 0 ? null : r.league].filter(Boolean).join(' · ') ||
        t('friends.incoming');
  const accept = () =>
    action.mutate({ kind: 'accept', userId: r.userId }, { onSuccess: () => showToast(t('friends.accepted', { name: r.pseudo }), 'success') });
  return (
    <Person
      pseudo={r.pseudo}
      avatar={r.avatar}
      line={meta}
      boxed
      onPress={() => router.push(`/joueur/${r.userId}` as Href)}
      right={
        r.direction === 'incoming' ? (
          <View style={styles.reqActions}>
            <Button label={t('friends.accept')} size="sm" loading={action.isPending} onPress={accept} />
          </View>
        ) : (
          <Button label={t('friends.cancel')} size="sm" variant="ghost" onPress={() => action.mutate({ kind: 'remove', userId: r.userId })} />
        )
      }
    />
  );
}

function SearchRow({ item }: { item: FriendSearchItem }) {
  const { t } = useTranslation('community');
  const action = useFriendAction();
  const line = item.relation === 'friend' ? t('friends.isFriend') : item.relation === 'outgoing' ? t('friends.sent') : item.relation === 'incoming' ? t('friends.incoming') : '';
  const right =
    item.relation === 'none' || item.relation === 'incoming' ? (
      <Button
        label={item.relation === 'incoming' ? t('friends.accept') : t('friends.add')}
        size="sm"
        loading={action.isPending}
        onPress={() =>
          action.mutate(item.relation === 'incoming' ? { kind: 'accept', userId: item.userId } : { kind: 'request', userId: item.userId }, {
            onSuccess: (res) =>
              showToast('relation' in res && res.relation === 'friend' ? t('friends.accepted', { name: item.pseudo }) : t('friends.requestSent', { name: item.pseudo }), 'success'),
          })
        }
      />
    ) : null;
  return <Person pseudo={item.pseudo} avatar={item.avatar} line={line} boxed right={right} onPress={() => router.push(`/joueur/${item.userId}` as Href)} />;
}

export function FriendsScreen() {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ onglet?: string }>();
  const [tab, setTab] = useState<Tab>(params.onglet === 'demandes' ? 'requests' : 'friends');
  const [q, setQ] = useState('');
  const [more, setMore] = useState<Friend | null>(null);
  const [removing, setRemoving] = useState<Friend | null>(null);
  const friends = useFriends();
  const requests = useFriendRequests();
  const search = useFriendSearch(q);
  const myCode = useMyFriendCode();
  const action = useFriendAction();
  const searching = q.trim().length >= 2;

  const share = () => {
    const code = myCode.data?.code;
    if (!code) return;
    void Share.share({ message: t('friends.inviteMessage', { link: friendLink(code), code }) }).catch(() => undefined);
  };
  const items = friends.data?.items ?? [];
  const online = items.filter((f) => f.online);
  const offline = items.filter((f) => !f.online);
  const incoming = requests.data?.incoming ?? [];
  const outgoing = requests.data?.outgoing ?? [];
  const pendingCount = friends.data?.incomingRequests ?? incoming.length;

  return (
    <Screen
      testID="screen-amis"
      refreshing={friends.isRefetching}
      onRefresh={() => {
        void friends.refetch();
        void requests.refetch();
      }}
      gap={12}
      header={<Header title={t('friends.title')} fallback="/" />}
    >
      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput
            accessibilityLabel={t('friends.search')}
            placeholder={t('friends.search')}
            placeholderTextColor={colors.textMuted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, textVariants.body, { color: colors.text }]}
          />
          {q ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('friends.cancel')} onPress={() => setQ('')} hitSlop={10} style={styles.clear}>
              <Icon name="close" size={18} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('friends.invite')}
          onPress={share}
          style={({ pressed }) => [styles.invite, { backgroundColor: colors.gain, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text variant="labelStrong" style={{ color: colors.bg }}>
            {t('friends.invite')}
          </Text>
        </Pressable>
      </View>

      {searching ? (
        <QueryBody query={search}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon="search" title={t('friends.noResultTitle')} message={t('friends.noResultMessage')} />
            ) : (
              <View style={styles.list}>
                <SectionLabel>{t('friends.results')}</SectionLabel>
                {data.items.map((it) => (
                  <SearchRow key={it.userId} item={it} />
                ))}
              </View>
            )
          }
        </QueryBody>
      ) : (
        <>
          <SegmentedTabs<Tab>
            accessibilityLabel={t('friends.tabs')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'friends', label: t('friends.tabFriends', { count: items.length }) },
              { value: 'requests', label: t('friends.tabRequests', { count: pendingCount }) },
            ]}
          />
          {tab === 'friends' ? (
            <QueryBody query={friends}>
              {() =>
                items.length === 0 ? (
                  <EmptyState
                    icon="friends"
                    title={t('friends.emptyTitle')}
                    message={t('friends.emptyMessage')}
                    action={{ label: t('friends.invite'), onPress: share }}
                  />
                ) : (
                  <View style={styles.list}>
                    {online.length > 0 ? <SectionLabel>{t('friends.online', { count: online.length })}</SectionLabel> : null}
                    {online.map((f) => (
                      <FriendRow key={f.userId} friend={f} onMore={setMore} />
                    ))}
                    {offline.length > 0 ? <SectionLabel>{t('friends.offline')}</SectionLabel> : null}
                    {offline.map((f) => (
                      <FriendRow key={f.userId} friend={f} onMore={setMore} />
                    ))}
                  </View>
                )
              }
            </QueryBody>
          ) : (
            <QueryBody query={requests}>
              {() => (
                <View style={styles.list}>
                  {incoming.length === 0 && outgoing.length === 0 ? (
                    <EmptyState icon="friends" title={t('friends.noRequestsTitle')} message={t('friends.noRequestsMessage')} />
                  ) : null}
                  {incoming.map((r) => (
                    <RequestRow key={r.userId} r={r} />
                  ))}
                  {outgoing.length > 0 ? <SectionLabel>{t('friends.outgoingTitle')}</SectionLabel> : null}
                  {outgoing.map((r) => (
                    <RequestRow key={r.userId} r={r} />
                  ))}
                </View>
              )}
            </QueryBody>
          )}
          <Text variant="small" tone="muted">
            {t('friends.requestsNote')}
          </Text>
          {myCode.data ? (
            <Text variant="caption" tone="muted">
              {t('friends.myCode', { code: myCode.data.code })}
            </Text>
          ) : null}
        </>
      )}

      <BottomSheet visible={more !== null} onClose={() => setMore(null)} accessibilityLabel={more ? t('friends.more', { name: more.pseudo }) : ''}>
        {more ? (
          <View style={styles.sheet}>
            <Text variant="title">{more.pseudo}</Text>
            <ListItem label={t('friends.profile')} icon="profile" chevron onPress={() => (setMore(null), router.push(`/joueur/${more.userId}` as Href))} />
            <ListItem
              label={t('friends.challenge')}
              icon="play"
              chevron
              onPress={() => (setMore(null), router.push({ pathname: '/defi/nouveau', params: { userId: more.userId, name: more.pseudo } } as Href))}
            />
            <ListItem label={t('friends.inviteRoom')} icon="send" chevron onPress={() => (setMore(null), showToast(t('friends.noRoom')), router.push('/salon/nouveau' as Href))} />
            <ListItem label={t('friends.report')} icon="flag" chevron onPress={() => (setMore(null), router.push(`/signaler/${more.userId}` as Href))} />
            <ListItem label={t('friends.remove')} icon="close" valueTone="alert" onPress={() => (setRemoving(more), setMore(null))} />
          </View>
        ) : null}
      </BottomSheet>
      <ConfirmSheet
        visible={removing !== null}
        title={removing ? t('friends.removeConfirm', { name: removing.pseudo }) : ''}
        message={t('friends.removeText')}
        confirmLabel={t('friends.remove')}
        cancelLabel={t('friends.cancel')}
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const name = removing.pseudo;
          await action.mutateAsync({ kind: 'remove', userId: removing.userId });
          setRemoving(null);
          showToast(t('friends.removed', { name }));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 52, borderRadius: 12, borderWidth: 1, paddingLeft: 14 },
  searchInput: { flex: 1, minWidth: 0, height: 50 },
  clear: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  invite: { height: 52, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  list: { gap: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, minHeight: 64 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  reqActions: { flexDirection: 'row', gap: 6 },
  sheet: { gap: 4 },
});
