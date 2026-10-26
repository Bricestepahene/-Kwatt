/**
 * Données des ligues (React Query sur le client REST). Le détail des routes est dans
 * @kwatt/protocol (http/leagues.ts).
 *
 *   const list = useLeagues('mine', 'all');      GET  /v1/leagues
 *   const league = useLeague(idOrCode);          GET  /v1/leagues/:id ou /by-code/:code
 *   const action = useLeagueAction(id);          POST /v1/leagues/:id/{join,leave,start,validate,cancel}
 *   const match = useLeagueMatch(id, matchId);   GET  /v1/leagues/:id/matches/:matchId
 *   const exclusion = useExclusion(id, userId);  GET  /v1/leagues/:id/exclusions/:userId
 */
import type {
  CreateLeagueRequest,
  LeagueBoard,
  LeagueDetail,
  LeagueExclusionView,
  LeagueListResponse,
  LeagueMatchView,
} from '@kwatt/protocol';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { isUuid, leagueCodeFrom } from './logic';

export const leagueKeys = {
  all: ['leagues'] as const,
  list: (scope: 'mine' | 'public', game: 'all' | 'dames' | 'ludo') => ['leagues', 'list', scope, game] as const,
  detail: (idOrCode: string) => ['leagues', 'detail', idOrCode] as const,
  match: (id: string, matchId: string) => ['leagues', 'match', id, matchId] as const,
  exclusion: (id: string, userId: string) => ['leagues', 'exclusion', id, userId] as const,
};

/** Une ligue se lit par son identifiant ou par son code d'invitation (kwatt://ligue/CODE). */
export function leaguePath(idOrCode: string): string {
  if (isUuid(idOrCode)) return `/v1/leagues/${idOrCode}`;
  return `/v1/leagues/by-code/${encodeURIComponent(leagueCodeFrom(idOrCode) ?? idOrCode)}`;
}

export function useLeagues(scope: 'mine' | 'public', game: 'all' | 'dames' | 'ludo', enabled = true) {
  return useQuery({
    queryKey: leagueKeys.list(scope, game),
    queryFn: () => api.get<LeagueListResponse>('/v1/leagues', { query: { scope, game } }),
    enabled,
  });
}

export function useLeague(idOrCode: string | undefined) {
  return useQuery({
    queryKey: leagueKeys.detail(idOrCode ?? ''),
    queryFn: () => api.get<LeagueDetail>(leaguePath(idOrCode ?? '')),
    enabled: Boolean(idOrCode),
  });
}

/** Après un changement : la ligue (par id et par code), les listes, le solde. */
function refresh(client: QueryClient, detail?: LeagueDetail) {
  if (detail) {
    client.setQueryData(leagueKeys.detail(detail.id), detail);
    client.setQueryData(leagueKeys.detail(detail.code), detail);
  }
  void client.invalidateQueries({ queryKey: leagueKeys.all });
  void client.invalidateQueries({ queryKey: ['wallet'] });
  void client.invalidateQueries({ queryKey: ['profile'] });
}

export function useCreateLeague() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeagueRequest) => api.post<LeagueDetail>('/v1/leagues', body),
    onSuccess: (detail) => refresh(client, detail),
  });
}

export type LeagueActionName = 'join' | 'leave' | 'start' | 'validate' | 'cancel';

export function useLeagueAction(leagueId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: LeagueActionName) => api.post<LeagueDetail>(`/v1/leagues/${leagueId ?? ''}/${action}`),
    onSuccess: (detail) => refresh(client, detail),
  });
}

export function useRemoveMember(leagueId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete<LeagueDetail>(`/v1/leagues/${leagueId ?? ''}/members/${encodeURIComponent(userId)}`),
    onSuccess: (detail) => refresh(client, detail),
  });
}

export function useLeagueMatch(leagueId: string | undefined, matchId: string | undefined) {
  return useQuery({
    queryKey: leagueKeys.match(leagueId ?? '', matchId ?? ''),
    queryFn: () => api.get<LeagueMatchView>(`/v1/leagues/${leagueId ?? ''}/matches/${encodeURIComponent(matchId ?? '')}`),
    enabled: Boolean(leagueId && matchId),
    // La salle s'ouvre, l'adversaire arrive : on relit toutes les 30 s.
    refetchInterval: 30_000,
  });
}

type MatchChange = { kind: 'time'; time: string } | { kind: 'board'; board: LeagueBoard } | { kind: 'arrive' };

export function useMatchAction(leagueId: string | undefined, matchId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: MatchChange) => {
      const base = `/v1/leagues/${leagueId ?? ''}/matches/${encodeURIComponent(matchId ?? '')}`;
      if (change.kind === 'time') return api.post<LeagueMatchView>(`${base}/time`, { time: change.time });
      if (change.kind === 'board') return api.post<LeagueMatchView>(`${base}/board`, { board: change.board });
      return api.post<LeagueMatchView>(`${base}/arrive`);
    },
    onSuccess: (view) => {
      client.setQueryData(leagueKeys.match(view.league.id, view.match.id), view);
      void client.invalidateQueries({ queryKey: ['leagues', 'detail'] });
    },
  });
}

export function useExclusion(leagueId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: leagueKeys.exclusion(leagueId ?? '', userId ?? ''),
    queryFn: () => api.get<LeagueExclusionView>(`/v1/leagues/${leagueId ?? ''}/exclusions/${encodeURIComponent(userId ?? '')}`),
    enabled: Boolean(leagueId && userId),
  });
}
