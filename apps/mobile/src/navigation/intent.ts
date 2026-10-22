/**
 * Où aller juste après une connexion, une inscription ou une session invitée.
 *
 * Les écrans d'entrée (Bienvenue, Inscription, Connexion…) sont réservés aux joueurs
 * sans profil : dès qu'un profil est connecté, la garde de session quitte l'écran.
 * Pour choisir la suite (ex. « vérifier l'e-mail » après l'inscription), l'écran la
 * déclare AVANT d'ouvrir la session, au lieu de naviguer lui-même (pas de course
 * entre deux navigations) :
 *
 *   setAfterSignIn('/verifier-email');
 *   await sessionStore.getState().signIn(réponse);
 *
 * Sans destination déclarée, la garde utilise `?next=` puis l'accueil.
 */
import { createStore } from 'zustand/vanilla';
import { safeNext } from './access';

const intentStore = createStore<{ afterSignIn: string | null }>()(() => ({ afterSignIn: null }));

/** Déclare la destination après connexion (chemin interne seulement), ou l'efface. */
export function setAfterSignIn(path: string | null): void {
  intentStore.setState({ afterSignIn: path === null ? null : safeNext(path, '/') });
}

/** Destination déclarée, sans l'effacer. */
export function peekAfterSignIn(): string | null {
  return intentStore.getState().afterSignIn;
}

/** Destination déclarée, effacée aussitôt (elle ne sert qu'une fois). */
export function takeAfterSignIn(): string | null {
  const path = intentStore.getState().afterSignIn;
  if (path !== null) intentStore.setState({ afterSignIn: null });
  return path;
}
