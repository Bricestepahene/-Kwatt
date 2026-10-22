/**
 * Session de l'appli (store unique, jetons dans le stockage sûr de l'appareil).
 *
 *   const status = useSession((s) => s.status);   // 'loading' | 'signedOut' | 'guest' | 'member'
 *   await sessionStore.getState().signIn(réponse);  // après POST /v1/auth/login, /register ou /guest
 */
import { randomUUID } from 'expo-crypto';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { AccessSession } from '../navigation/access';
import { secureStorage } from '../storage/deviceStorage';
import { createInstallIdProvider } from './installId';
import { createSessionStore, type SessionState } from './session';

export * from './session';

export const sessionStore = createSessionStore(secureStorage);

/** Identifiant d'installation (tiré au premier lancement). */
export const getInstallId = createInstallIdProvider(secureStorage, randomUUID);

export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(sessionStore, selector);
}

/** Vue de la session pour la garde de navigation (statut, majorité). */
export function useAccessSession(): AccessSession {
  const status = useSession((s) => s.status);
  const isAdult = useSession((s) => s.data?.user.ageBand === 'adult');
  return useMemo(() => ({ status: status === 'member' || status === 'guest' ? status : 'signedOut', isAdult }), [status, isAdult]);
}

/**
 * Session de démonstration, pour parcourir l'appli sans serveur pendant le développement
 * (bouton visible seulement en __DEV__ sur l'écran provisoire de Bienvenue).
 * À retirer quand l'équipe Comptes branche la vraie connexion.
 */
export async function startDemoSession(): Promise<void> {
  await sessionStore.getState().signIn({
    accessToken: 'demo',
    refreshToken: 'demo',
    expiresIn: 365 * 24 * 3600,
    user: { id: 'demo', kind: 'member', pseudo: 'demo', ageBand: 'adult', emailVerified: true },
  });
}
