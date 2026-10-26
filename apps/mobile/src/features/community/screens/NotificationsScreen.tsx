/**
 * Écran 08 · Notifications (planche Notifications) : « À faire maintenant » (parties où c'est
 * ton tour, défis qui t'attendent), puis Aujourd'hui, Hier, Plus tôt. Chaque carte porte une
 * bande de tissu : bois pour les Dames, kaba pour le Ludo, ndop pour le hub, vert pour un gain.
 * Le serveur n'envoie que des codes : les textes viennent du catalogue `community`.
 */
import type { ChallengeView, MyGamesResponse, Notification } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFormat } from '@/i18n';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Button, EmptyState, Fabric, Header, Screen, SectionLabel, Text, showToast } from '@/ui';
import { useChallengeAction } from '../../online/api';
import { QueryBody } from '../../leagues/components';
import { useChallenges, useMarkRead, useMyGames, useNotifications } from '../api';
import { groupByDay, isKnownKind, notificationAction, notificationBand, notificationHref, type NotificationBand } from '../logic';

type MyGame = MyGamesResponse['items'][number];

/** Bande de tissu à gauche d'une carte. */
function Band({ band }: { band: NotificationBand }) {
  const { colors } = useTheme();
  if (band === 'gain') return <View style={[styles.band, { backgroundColor: colors.gain }]} />;
  return <Fabric name={band} style={styles.band} />;
}

function Card({
  band,
  title,
  meta,
  unread,
  onPress,
  children,
  label,
}: {
  band: NotificationBand;
  title: string;
  meta: string | null;
  unread?: boolean;
  onPress?: (() => void) | undefined;
  children?: React.ReactNode;
  label?: string;
}) {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  const body = (
    <>
      <Band band={band} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" style={styles.flex}>
            {title}
          </Text>
          {unread ? <View style={[styles.unread, { backgroundColor: colors.alert }]} accessibilityLabel={t('notifications.unread')} /> : null}
        </View>
        {meta ? (
          <Text variant="small" tone="muted">
            {meta}
          </Text>
        ) : null}
        {children ? <View style={styles.actions}>{children}</View> : null}
      </View>
    </>
  );
  const style = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  if (!onPress || children) return <View style={style}>{body}</View>;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label ?? [title, meta].filter(Boolean).join('. ')} onPress={onPress} style={({ pressed }) => [style, { opacity: pressed ? 0.88 : 1 }]}>
      {body}
    </Pressable>
  );
}

function TurnCard({ game }: { game: MyGame }) {
  const { t } = useTranslation('community');
  const names = game.seats.filter((s) => s.seat !== game.mySeat).map((s) => s.pseudo);
  const where = game.room?.name ?? game.league?.name ?? null;
  const href = game.family === 'dames' ? `/dames/partie/${game.id}` : `/ludo/partie/${game.id}`;
  return (
    <Card
      band={game.family === 'dames' ? 'obom' : 'kaba'}
      title={where ? t('notifications.yourTurn', { where }) : t('notifications.yourTurnGame')}
      meta={t('notifications.turnAgainst', { game: t(`home.${game.family}`), names: names.join(', ') })}
    >
      <Button label={t('notifications.play')} size="sm" onPress={() => router.push(href as Href)} />
    </Card>
  );
}

function ChallengeCard({ challenge }: { challenge: ChallengeView }) {
  const { t } = useTranslation('community');
  const f = useFormat();
  const action = useChallengeAction(challenge.id);
  const left = Math.max(0, Date.parse(challenge.expiresAt) - Date.now());
  const time = left >= 3_600_000 ? `${Math.round(left / 3_600_000)} h` : `${Math.max(1, Math.round(left / 60_000))} min`;
  return (
    <Card
      band={challenge.game === 'dames' ? 'obom' : 'kaba'}
      title={
        challenge.stake > 0
          ? t('notifications.challengeTitle', { from: challenge.from.pseudo, stake: f.cauris(challenge.stake) })
          : t('notifications.challengeTitleFree', { from: challenge.from.pseudo })
      }
      meta={t('notifications.challengeMeta', { game: t(`home.${challenge.game}`), time })}
    >
      <Button label={t('notifications.see')} size="sm" onPress={() => router.push(`/defi/${challenge.id}` as Href)} />
      <Button
        label={t('notifications.refuse')}
        size="sm"
        variant="outline"
        loading={action.isPending}
        onPress={() => action.mutate({ kind: 'decline' }, { onSuccess: () => showToast(t('notifications.refused')) })}
      />
    </Card>
  );
}

/** Paramètres affichables : noms de jeux, montants, quêtes et cartes traduits. */
function useParams() {
  const { t } = useTranslation('community');
  const { t: ti } = useTranslation('items');
  const f = useFormat();
  return (n: Notification): Record<string, string | number> => {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(n.params)) if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    const p = n.params;
    if (p.game === 'dames' || p.game === 'ludo') out.game = t(`home.${p.game}`);
    if (typeof p.stake === 'number') out.stake = f.cauris(p.stake);
    if (typeof p.questId === 'string') out.quest = t(`rewards.quest.${p.questId}` as 'rewards.quest.rafle_3');
    if (typeof p.code === 'string' && n.kind === 'rewards.card') out.card = ti(`name.${p.code}` as 'name.card_table_village');
    if (typeof p.refund === 'number') out.refund = f.caurisAmount(p.refund);
    if (typeof p.amount === 'number') out.amount = f.caurisAmount(p.amount);
    if (typeof p.minutes === 'number') out.delay = p.minutes >= 60 && p.minutes % 60 === 0 ? `${p.minutes / 60} h` : `${p.minutes} min`;
    return out;
  };
}

function NotificationCard({ n }: { n: Notification }) {
  const { t } = useTranslation('community');
  const params = useParams()(n);
  const known = isKnownKind(n.kind);
  const title = known ? t(`notifications.kind.${n.kind}.title` as 'notifications.kind.quest.completed.title', params) : t('notifications.unknown');
  const meta = known ? t(`notifications.kind.${n.kind}.body` as 'notifications.kind.quest.completed.body', params) : null;
  const href = notificationHref(n);
  const action = notificationAction(n.kind);
  const go = href ? () => router.push(href as Href) : undefined;
  return (
    <Card band={notificationBand(n)} title={title} meta={meta} unread={n.readAt === null} onPress={go}>
      {action && go ? <Button label={t(`notifications.${action}`)} size="sm" variant={action === 'claim' ? 'primary' : 'outline'} onPress={go} /> : null}
    </Card>
  );
}

export function NotificationsScreen() {
  const { t } = useTranslation('community');
  const me = useSession((s) => s.data?.user.id ?? null);
  const list = useNotifications();
  const games = useMyGames();
  const challenges = useChallenges();
  const markRead = useMarkRead();
  const turns = (games.data?.items ?? []).filter((g) => g.myTurn);
  const waiting = (challenges.data?.items ?? []).filter((c) => c.status === 'pending' && c.awaiting === me && Date.parse(c.expiresAt) > Date.now());
  const groups = useMemo(() => groupByDay(list.data?.items ?? [], Date.now()), [list.data]);
  const unread = list.data?.unreadCount ?? 0;

  // Ouvrir l'écran vaut lecture : les points rouges s'éteignent au départ.
  const { mutate } = markRead;
  useEffect(() => {
    if (unread > 0) return () => mutate({ all: true });
    return undefined;
  }, [unread, mutate]);

  const refresh = () => {
    void list.refetch();
    void games.refetch();
    void challenges.refetch();
  };
  const sections: { key: 'today' | 'yesterday' | 'earlier'; items: Notification[] }[] = [
    { key: 'today', items: groups.today },
    { key: 'yesterday', items: groups.yesterday },
    { key: 'earlier', items: groups.earlier },
  ];
  const nothing = turns.length === 0 && waiting.length === 0 && (list.data?.items.length ?? 0) === 0;

  return (
    <Screen
      testID="screen-notifications"
      refreshing={list.isRefetching}
      onRefresh={refresh}
      gap={10}
      header={
        <Header
          title={t('notifications.title')}
          fallback="/"
          right={
            <Pressable accessibilityRole="link" onPress={() => router.push('/parametres' as Href)} hitSlop={12} style={styles.settings}>
              <Text variant="labelStrong" tone="action" style={styles.underline}>
                {t('notifications.settings')}
              </Text>
            </Pressable>
          }
        />
      }
    >
      <QueryBody query={list}>
        {() =>
          nothing ? (
            <EmptyState icon="bell" title={t('notifications.emptyTitle')} message={t('notifications.emptyMessage')} />
          ) : (
            <>
              {turns.length + waiting.length > 0 ? <SectionLabel>{t('notifications.todo')}</SectionLabel> : null}
              {turns.map((g) => (
                <TurnCard key={g.id} game={g} />
              ))}
              {waiting.map((c) => (
                <ChallengeCard key={c.id} challenge={c} />
              ))}
              {sections.map((s) =>
                s.items.length === 0 ? null : (
                  <View key={s.key} style={styles.section}>
                    <SectionLabel>{t(`notifications.${s.key}`)}</SectionLabel>
                    {s.items.map((n) => (
                      <NotificationCard key={n.id} n={n} />
                    ))}
                  </View>
                ),
              )}
              {unread > 1 ? <Button label={t('notifications.markAll')} variant="ghost" size="sm" onPress={() => markRead.mutate({ all: true })} /> : null}
              <Text variant="caption" tone="muted" align="center" style={styles.legend}>
                {t('notifications.legend')}
              </Text>
            </>
          )
        }
      </QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, overflow: 'hidden', minHeight: 64 },
  band: { width: 8 },
  body: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unread: { width: 8, height: 8, borderRadius: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  section: { gap: 10 },
  settings: { minHeight: 48, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
  legend: { marginTop: 18, paddingHorizontal: 12 },
});
