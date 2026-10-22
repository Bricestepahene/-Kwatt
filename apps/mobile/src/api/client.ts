/**
 * Instances de l'appli : client REST, client temps réel et cache React Query, reliés à
 * la session, à la langue et au réseau.
 *
 *   import { api, ws } from '@/api/client';
 *   const rooms = await api.get<Page<Room>>('/v1/rooms', { query: { limit: 20 } });
 *   const off = ws.on('game.state', (m) => …);
 */
import { QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { env } from '../config/env';
import { currentLanguage } from '../i18n';
import { networkStore } from '../offline/network';
import { getInstallId, sessionStore } from '../session';
import { isApiError } from './errors';
import { createRestClient } from './rest';
import { API_PATHS, type AuthResponse } from './types';
import { createWsClient } from './ws';

export const api = createRestClient({
  baseUrl: env.apiUrl,
  fetch: (input, init) => fetch(input, init),
  getTokens: () => sessionStore.getState().data?.tokens ?? null,
  onTokens: (tokens) => sessionStore.getState().setTokens(tokens),
  onSessionExpired: () => sessionStore.getState().signOut(),
  getHeaders: async () => ({
    'Accept-Language': currentLanguage(),
    'X-Install-Id': await getInstallId(),
    'X-App-Version': `${env.appVersion}/${Platform.OS}`,
  }),
});

export const ws = createWsClient({
  url: env.wsUrl,
  createSocket: (url) => new WebSocket(url),
  getToken: () => api.getFreshAccessToken(),
  onAuthFailure: async () => {
    await api.refresh().catch(() => null);
  },
});

/** Cache des données serveur. Pas de nouvel essai sur une erreur 4xx (le serveur a tranché). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (failureCount, error) => {
        if (isApiError(error) && !error.isTransient) return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: Platform.OS === 'web',
    },
    mutations: { retry: false },
  },
});

let wired = false;

/**
 * Relie le temps réel à la session, au réseau et au premier plan de l'appli :
 * connexion dès qu'une session existe, fermeture à la déconnexion, reconnexion
 * immédiate au retour du réseau ou de l'appli.
 */
export function startRealtime(): () => void {
  if (wired) return () => undefined;
  wired = true;

  const sync = () => {
    const { status } = sessionStore.getState();
    if (status === 'member' || status === 'guest') ws.connect();
    else if (status === 'signedOut') {
      ws.disconnect();
      queryClient.clear();
    }
  };
  sync();
  const offSession = sessionStore.subscribe((state, previous) => {
    if (state.status !== previous.status || state.data?.user.id !== previous.data?.user.id) sync();
  });
  const offNetwork = networkStore.subscribe((state, previous) => {
    if (state.isOnline && previous.isOnline === false) ws.reconnectNow();
  });
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') ws.reconnectNow();
  });

  return () => {
    wired = false;
    offSession();
    offNetwork();
    appState.remove();
  };
}

/** Session invitée (écran 02, « Regarder » sans profil) : POST /v1/auth/guest avec l'identifiant d'installation. */
export async function startGuestSession(displayName?: string): Promise<void> {
  const installId = await getInstallId();
  const response = await api.post<AuthResponse>(
    API_PATHS.guest,
    { installId, ...(displayName ? { displayName } : {}), locale: currentLanguage() },
    { auth: false },
  );
  await sessionStore.getState().signIn(response);
}

/** Déconnexion : prévient le serveur (au mieux), puis efface la session de l'appareil. */
export async function signOut(): Promise<void> {
  const refreshToken = sessionStore.getState().data?.tokens.refreshToken;
  if (refreshToken) {
    await api.post(API_PATHS.logout, { refreshToken }).catch(() => undefined);
  }
  await sessionStore.getState().signOut();
}
