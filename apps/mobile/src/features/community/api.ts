/**
 * Données Communauté et progression (React Query + temps réel). Contrats : @kwatt/protocol
 * (http/home.ts, http/friends.ts, http/reports.ts, http/progression.ts, http/notifications.ts).
 *
 *   useHome()                 GET /v1/home ; useMyGames() GET /v1/games/mine ; useChallenges() GET /v1/challenges
 *   useNotifications()        GET /v1/notifications (+ `notify` en direct), useMarkRead()
 *   useFriends()              GET /v1/friends (+ `presence.update` en direct)
 *   useFriendRequests()       GET /v1/friends/requests ; useFriendSearch(q) ; useMyFriendCode()
 *   useFriendByCode(code)     GET /v1/friends/code/:code ; useFriendAction()
 *   useReportContext(userId)  GET /v1/reports/context/:userId ; useReport() ; useBlock()
 *   useStandings(scope)       GET /v1/quarters/standings
 *   useCards() / useEquip()   GET /v1/cards, PUT /v1/cards/equipped
 *   useRewards() / useClaim() GET /v1/rewards, POST …/claim, POST …/streak/choose
 *   useWaitlist()             GET|POST|DELETE /v1/reasoning/waitlist
 */
import type {
  CardCollection,
  ChallengeListResponse,
  CardSlot,
  ClaimResult,
  FriendCodeTarget,
  FriendRequestResult,
  FriendRequestsResponse,
  FriendSearchResponse,
  FriendsResponse,
  HomeView,
  MyFriendCode,
  MyGamesResponse,
  NotificationListResponse,
  NotifyMessage,
  PresenceUpdateMessage,
  QuarterScope,
  QuarterStandings,
  ReasoningWaitlist,
  ReportContext,
  ReportRequest,
  ReportResult,
  RewardsView,
  UnreadCountResponse,
} from '@kwatt/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, ws } from '../../api/client';

export const communityKeys = {
  home: ['home'] as const,
  notifications: ['notifications', 'list'] as const,
  friends: ['friends', 'list'] as const,
  requests: ['friends', 'requests'] as const,
  search: (q: string) => ['friends', 'search', q] as const,
  myCode: ['friends', 'code'] as const,
  byCode: (code: string) => ['friends', 'code', code] as const,
  report: (userId: string) => ['reports', userId] as const,
  standings: (scope: QuarterScope) => ['quarters', 'standings', scope] as const,
  cards: ['cards'] as const,
  rewards: ['rewards'] as const,
  waitlist: ['reasoning', 'waitlist'] as const,
};

export function useHome(enabled = true) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: communityKeys.home, queryFn: () => api.get<HomeView>('/v1/home'), enabled, refetchInterval: 60_000 });
  useEffect(() => {
    if (!enabled) return;
    return ws.on<NotifyMessage>('notify', () => void client.invalidateQueries({ queryKey: communityKeys.home }));
  }, [client, enabled]);
  return query;
}

/** « À faire maintenant » : parties où c'est ton tour, défis qui t'attendent. */
export function useMyGames() {
  return useQuery({ queryKey: ['games', 'mine'] as const, queryFn: () => api.get<MyGamesResponse>('/v1/games/mine'), refetchInterval: 30_000 });
}

export function useChallenges() {
  return useQuery({ queryKey: ['challenges', 'list'] as const, queryFn: () => api.get<ChallengeListResponse>('/v1/challenges') });
}

// --- Notifications -------------------------------------------------------------------

export function useNotifications() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: communityKeys.notifications,
    queryFn: () => api.get<NotificationListResponse>('/v1/notifications', { query: { limit: 50 } }),
  });
  useEffect(
    () =>
      ws.on<NotifyMessage>('notify', (m) => {
        client.setQueryData<NotificationListResponse>(communityKeys.notifications, (old) =>
          old ? { ...old, items: [m.notification, ...old.items.filter((n) => n.id !== m.notification.id)], unreadCount: m.unreadCount } : old,
        );
      }),
    [client],
  );
  return query;
}

export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) => api.post<UnreadCountResponse>('/v1/notifications/read', body),
    onSuccess: (res, body) => {
      const now = new Date().toISOString();
      client.setQueryData<NotificationListResponse>(communityKeys.notifications, (old) =>
        old
          ? {
              ...old,
              unreadCount: res.unreadCount,
              items: old.items.map((n) => ('all' in body || body.ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)),
            }
          : old,
      );
      void client.invalidateQueries({ queryKey: communityKeys.home });
    },
  });
}

// --- Amis ----------------------------------------------------------------------------

export function useFriends() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: communityKeys.friends, queryFn: () => api.get<FriendsResponse>('/v1/friends'), refetchInterval: 30_000 });
  useEffect(
    () =>
      ws.on<PresenceUpdateMessage>('presence.update', (m) => {
        const changed = new Map(m.users.map((u) => [u.userId, u]));
        client.setQueryData<FriendsResponse>(communityKeys.friends, (old) => {
          if (!old) return old;
          const items = old.items.map((f) => {
            const u = changed.get(f.userId);
            if (!u) return f;
            const { activity: _gone, ...rest } = f;
            return u.online ? { ...f, online: true, lastSeenAt: null } : { ...rest, online: false, lastSeenAt: u.lastSeenAt };
          });
          return { ...old, items };
        });
        // Nouvel ami : la liste se recharge pour l'ajouter.
        const known = client.getQueryData<FriendsResponse>(communityKeys.friends);
        if (known && m.users.some((u) => !known.items.some((f) => f.userId === u.userId))) void client.invalidateQueries({ queryKey: communityKeys.friends });
      }),
    [client],
  );
  return query;
}

export function useFriendRequests() {
  return useQuery({ queryKey: communityKeys.requests, queryFn: () => api.get<FriendRequestsResponse>('/v1/friends/requests') });
}

export function useFriendSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: communityKeys.search(term),
    queryFn: () => api.get<FriendSearchResponse>('/v1/friends/search', { query: { q: term } }),
    enabled: term.length >= 2,
  });
}

export function useMyFriendCode() {
  return useQuery({ queryKey: communityKeys.myCode, queryFn: () => api.get<MyFriendCode>('/v1/friends/code'), staleTime: Infinity });
}

export function useFriendByCode(code: string | undefined) {
  return useQuery({
    queryKey: communityKeys.byCode(code ?? ''),
    queryFn: () => api.get<FriendCodeTarget>(`/v1/friends/code/${code}`),
    enabled: Boolean(code),
    retry: false,
  });
}

export type FriendAction =
  | { kind: 'request'; userId: string }
  | { kind: 'requestCode'; code: string }
  | { kind: 'accept'; userId: string }
  | { kind: 'decline'; userId: string }
  | { kind: 'remove'; userId: string };

export function useFriendAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (a: FriendAction): Promise<FriendRequestResult | { ok: true }> => {
      switch (a.kind) {
        case 'request':
          return api.post<FriendRequestResult>('/v1/friends/requests', { userId: a.userId });
        case 'requestCode':
          return api.post<FriendRequestResult>('/v1/friends/requests', { code: a.code });
        case 'accept':
          return api.post<FriendRequestResult>(`/v1/friends/requests/${a.userId}/accept`, {});
        case 'decline':
          return api.post<{ ok: true }>(`/v1/friends/requests/${a.userId}/decline`, {});
        case 'remove':
          return api.delete<{ ok: true }>(`/v1/friends/${a.userId}`);
      }
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['friends'] }),
  });
}

// --- Signaler, bloquer ---------------------------------------------------------------

export function useReportContext(userId: string | undefined) {
  return useQuery({
    queryKey: communityKeys.report(userId ?? ''),
    queryFn: () => api.get<ReportContext>(`/v1/reports/context/${userId}`),
    enabled: Boolean(userId),
  });
}

export function useReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ReportRequest) => api.post<ReportResult>('/v1/reports', body),
    onSuccess: (_r, body) => {
      void client.invalidateQueries({ queryKey: communityKeys.report(body.userId) });
      void client.invalidateQueries({ queryKey: ['friends'] });
    },
  });
}

export function useBlock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (a: { userId: string; block: boolean }) =>
      a.block ? api.post<{ ok: true }>('/v1/blocks', { userId: a.userId }) : api.delete<{ ok: true }>(`/v1/blocks/${a.userId}`),
    onSuccess: (_r, a) => {
      void client.invalidateQueries({ queryKey: communityKeys.report(a.userId) });
      void client.invalidateQueries({ queryKey: ['friends'] });
    },
  });
}

// --- Progression ---------------------------------------------------------------------

export function useStandings(scope: QuarterScope) {
  return useQuery({
    queryKey: communityKeys.standings(scope),
    queryFn: () => api.get<QuarterStandings>('/v1/quarters/standings', { query: { scope } }),
  });
}

export function useCards() {
  return useQuery({ queryKey: communityKeys.cards, queryFn: () => api.get<CardCollection>('/v1/cards') });
}

export function useEquip() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { slot: CardSlot; code: string | null }) => api.put<CardCollection>('/v1/cards/equipped', body),
    onSuccess: (c) => client.setQueryData(communityKeys.cards, c),
  });
}

export function useRewards() {
  return useQuery({ queryKey: communityKeys.rewards, queryFn: () => api.get<RewardsView>('/v1/rewards') });
}

export function useClaim() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (a: { kind: 'quest'; questId: string } | { kind: 'streak'; code: string }) =>
      a.kind === 'quest' ? api.post<ClaimResult>(`/v1/rewards/quests/${a.questId}/claim`, {}) : api.post<ClaimResult>('/v1/rewards/streak/choose', { code: a.code }),
    onSuccess: (res) => {
      client.setQueryData(communityKeys.rewards, res.rewards);
      void client.invalidateQueries({ queryKey: communityKeys.cards });
      void client.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}

export function useWaitlist() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: communityKeys.waitlist, queryFn: () => api.get<ReasoningWaitlist>('/v1/reasoning/waitlist') });
  const toggle = useMutation({
    mutationFn: (join: boolean) => (join ? api.post<ReasoningWaitlist>('/v1/reasoning/waitlist', {}) : api.delete<ReasoningWaitlist>('/v1/reasoning/waitlist')),
    onSuccess: (w) => client.setQueryData(communityKeys.waitlist, w),
  });
  return { query, toggle };
}
