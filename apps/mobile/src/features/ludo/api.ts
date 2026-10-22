/**
 * Données de l'espace Ludo (React Query sur le client REST).
 *
 *   useLudoRatings()              GET  /v1/ratings/me (C1, équipe Dames)
 *   useMachineOffers(…)           GET  /v1/machine/offers?family=ludo (C2, équipe Dames)
 *   createOnlineMachineGame(…)    POST /v1/games/machine (C3, équipe Parties en ligne : pari)
 *   useHouseRuleSets()            GET  /v1/ludo/house-rules
 *   useSaveHouseRuleSet()         POST /v1/ludo/house-rules
 *   useDeleteHouseRuleSet()       DELETE /v1/ludo/house-rules/:id
 */
import type {
  CreateHouseRuleSetRequest,
  CreateMachineGameRequest,
  CreateMachineGameResponse,
  HouseRuleSet,
  HouseRuleSetList,
  MachineOffersResponse,
  MyRatingsResponse,
} from '@kwatt/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

export const ludoKeys = {
  ratings: ['ratings', 'me'] as const,
  offers: (variant: string, machines: number) => ['machine', 'offers', 'ludo', variant, machines] as const,
  houseRules: ['ludo', 'house-rules'] as const,
};

export function useLudoRatings(enabled = true) {
  return useQuery({ queryKey: ludoKeys.ratings, queryFn: () => api.get<MyRatingsResponse>('/v1/ratings/me'), enabled, retry: 1 });
}

export function useMachineOffers(variant: string, machines: number, enabled = true) {
  return useQuery({
    queryKey: ludoKeys.offers(variant, machines),
    queryFn: () => api.get<MachineOffersResponse>('/v1/machine/offers', { query: { family: 'ludo', variant, machines } }),
    enabled,
    retry: 1,
  });
}

export function createOnlineMachineGame(body: CreateMachineGameRequest): Promise<CreateMachineGameResponse> {
  return api.post<CreateMachineGameResponse>('/v1/games/machine', body);
}

export function useHouseRuleSets(enabled = true) {
  return useQuery({ queryKey: ludoKeys.houseRules, queryFn: () => api.get<HouseRuleSetList>('/v1/ludo/house-rules'), enabled });
}

export function useSaveHouseRuleSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHouseRuleSetRequest) => api.post<HouseRuleSet>('/v1/ludo/house-rules', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ludoKeys.houseRules }),
  });
}

export function useDeleteHouseRuleSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/ludo/house-rules/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ludoKeys.houseRules }),
  });
}
