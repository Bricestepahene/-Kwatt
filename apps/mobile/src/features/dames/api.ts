/**
 * Données des écrans Dames (React Query sur le client REST) :
 *
 *   useRatings()                      GET  /v1/ratings/me            (C1)
 *   useMachineOffers('dames', v)      GET  /v1/machine/offers         (C2)
 *   useWallet()                       GET  /v1/wallet
 *   useDailyPuzzle(v)                 GET  /v1/puzzles/daily          (19b)
 *   useSolvePuzzle()                  POST /v1/puzzles/daily/solve
 *   useGameSummary(id)                GET  /v1/games/:id              (C3, Parties en ligne)
 *   createMachineGame(body)           POST /v1/games/machine          (C3, partie avec pari)
 */
import type {
  CreateMachineGameRequest,
  CreateMachineGameResponse,
  DailyPuzzleResponse,
  DailyPuzzleSolveRequest,
  DailyPuzzleSolveResponse,
  GameSummary,
  MachineFamily,
  MachineOffersResponse,
  MyRatingsResponse,
  PuzzleVariant,
  WalletResponse,
} from '@kwatt/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

export const damesKeys = {
  ratings: ['ratings', 'me'] as const,
  offers: (family: MachineFamily, variant: string, machines = 1) => ['machine', 'offers', family, variant, machines] as const,
  wallet: ['wallet'] as const,
  puzzle: (variant: PuzzleVariant) => ['puzzles', 'daily', variant] as const,
  game: (id: string) => ['games', id] as const,
};

export function useRatings(enabled = true) {
  return useQuery({ queryKey: damesKeys.ratings, queryFn: () => api.get<MyRatingsResponse>('/v1/ratings/me'), enabled });
}

export function useMachineOffers(family: MachineFamily, variant: string, machines = 1, enabled = true) {
  return useQuery({
    queryKey: damesKeys.offers(family, variant, machines),
    queryFn: () => api.get<MachineOffersResponse>('/v1/machine/offers', { query: { family, variant, machines } }),
    enabled,
  });
}

export function useWallet(enabled = true) {
  return useQuery({ queryKey: damesKeys.wallet, queryFn: () => api.get<WalletResponse>('/v1/wallet'), enabled });
}

export function useDailyPuzzle(variant: PuzzleVariant, enabled = true) {
  return useQuery({
    queryKey: damesKeys.puzzle(variant),
    queryFn: () => api.get<DailyPuzzleResponse>('/v1/puzzles/daily', { query: { variant } }),
    enabled,
  });
}

export function useSolvePuzzle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: DailyPuzzleSolveRequest) => api.post<DailyPuzzleSolveResponse>('/v1/puzzles/daily/solve', body),
    onSuccess: (res) => {
      if (res.reward > 0) {
        void client.invalidateQueries({ queryKey: ['puzzles'] });
        void client.invalidateQueries({ queryKey: damesKeys.wallet });
        void client.invalidateQueries({ queryKey: ['profile'] });
      }
    },
  });
}

export function useGameSummary(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: damesKeys.game(id ?? ''),
    queryFn: () => api.get<GameSummary>(`/v1/games/${encodeURIComponent(id ?? '')}`),
    enabled: enabled && Boolean(id),
    retry: 1,
  });
}

export function createMachineGame(body: CreateMachineGameRequest): Promise<CreateMachineGameResponse> {
  return api.post<CreateMachineGameResponse>('/v1/games/machine', body);
}
