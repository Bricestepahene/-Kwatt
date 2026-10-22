/**
 * Données du profil, de l'avatar et de la boutique (React Query sur le client REST).
 *
 *   const profile = useMyProfile();          GET /v1/me/profile
 *   const other = usePlayerProfile(userId);  GET /v1/profiles/:userId
 *   const catalog = useCatalog();            GET /v1/shop/items (familles du Studio)
 *   const buy = useBuy();                    POST /v1/shop/buy
 *   const save = useSaveAvatar();            PUT /v1/me/avatar
 *   const upload = useUploadPhoto();         POST /v1/me/photo (multipart)
 *   const journal = useJournal();            GET /v1/wallet/journal (pages)
 */
import type {
  BuyResponse,
  JournalResponse,
  MyAvatar,
  Profile,
  SaveAvatarRequest,
  ShopCatalogResponse,
} from '@kwatt/protocol';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { STUDIO_KINDS } from './studio';

export const profileKeys = {
  me: ['profile', 'me'] as const,
  player: (userId: string) => ['profile', 'player', userId] as const,
  avatar: ['profile', 'avatar'] as const,
  catalog: ['shop', 'items', 'studio'] as const,
  journal: ['wallet', 'journal'] as const,
};

export function useMyProfile() {
  return useQuery({ queryKey: profileKeys.me, queryFn: () => api.get<Profile>('/v1/me/profile') });
}

export function usePlayerProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.player(userId ?? ''),
    queryFn: () => api.get<Profile>(`/v1/profiles/${encodeURIComponent(userId ?? '')}`),
    enabled: Boolean(userId),
  });
}

export function useMyAvatar() {
  return useQuery({ queryKey: profileKeys.avatar, queryFn: () => api.get<MyAvatar>('/v1/me/avatar') });
}

export function useCatalog() {
  return useQuery({
    queryKey: profileKeys.catalog,
    queryFn: () => api.get<ShopCatalogResponse>('/v1/shop/items', { query: { kinds: STUDIO_KINDS.join(',') } }),
  });
}

export function useJournal(limit = 30) {
  return useInfiniteQuery({
    queryKey: profileKeys.journal,
    queryFn: ({ pageParam }) =>
      api.get<JournalResponse>('/v1/wallet/journal', { query: { limit, ...(pageParam ? { cursor: pageParam } : {}) } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Après un achat ou un changement d'avatar : profil, catalogue, solde et journal à relire. */
function refreshAfterChange(client: QueryClient) {
  void client.invalidateQueries({ queryKey: ['profile'] });
  void client.invalidateQueries({ queryKey: ['shop'] });
  void client.invalidateQueries({ queryKey: ['wallet'] });
}

export function useBuy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (codes: readonly string[]) =>
      api.post<BuyResponse>('/v1/shop/buy', codes.length === 1 ? { itemCode: codes[0] } : { itemCodes: [...codes] }),
    onSuccess: () => refreshAfterChange(client),
  });
}

export function useSaveAvatar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveAvatarRequest) => api.put<MyAvatar>('/v1/me/avatar', body),
    onSuccess: (mine) => {
      client.setQueryData(profileKeys.avatar, mine);
      refreshAfterChange(client);
    },
  });
}

export function useUploadPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api.post<MyAvatar>('/v1/me/photo', form),
    onSuccess: (mine) => {
      client.setQueryData(profileKeys.avatar, mine);
      void client.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useDeletePhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<MyAvatar>('/v1/me/photo'),
    onSuccess: (mine) => {
      client.setQueryData(profileKeys.avatar, mine);
      void client.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
