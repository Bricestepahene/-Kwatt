/**
 * Ouverture et fermeture de session côté Comptes : la garde de navigation choisit l'écran
 * suivant (setAfterSignIn), le profil reçu remplit le cache, le jeton push part au serveur.
 */
import type { AuthSessionResponse, Me } from '@kwatt/protocol';
import { queryClient, signOut as clientSignOut } from '../../api/client';
import { setAfterSignIn } from '../../navigation/intent';
import { sessionStore } from '../../session';
import { accountKeys } from './api';
import { forgetPushToken, registerPushToken } from './push';

/**
 * Nouvelle session (connexion, inscription, mot de passe réinitialisé). `next` : écran où la
 * garde de session emmène le joueur (sur un écran d'entrée réservé aux joueurs sans profil).
 */
export async function completeSignIn(response: AuthSessionResponse, next: string | null): Promise<void> {
  if (next !== null) setAfterSignIn(next);
  await sessionStore.getState().signIn(response);
  queryClient.setQueryData(accountKeys.me, response.me);
  if (response.me.kind === 'member') void registerPushToken();
}

/** Profil relu sur le serveur : session et cache à jour. */
export async function rememberMe(me: Me): Promise<void> {
  queryClient.setQueryData(accountKeys.me, me);
  await sessionStore.getState().applyMe(me);
}

/** Déconnexion de cet appareil (POST /v1/auth/logout), puis retour à Bienvenue par la garde. */
export async function signOutHere(): Promise<void> {
  forgetPushToken();
  await clientSignOut();
}

/** Session déjà fermée par le serveur (déconnexion partout, suppression) : on oublie l'appareil. */
export async function forgetSession(): Promise<void> {
  forgetPushToken();
  await sessionStore.getState().signOut();
}
