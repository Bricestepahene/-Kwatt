/**
 * Brouillon de l'inscription, entre l'écran 03 (pseudo, e-mail, mot de passe, cadre,
 * consentement) et l'écran 04 (année de naissance, envoi). En mémoire seulement : le mot de
 * passe n'est jamais écrit sur l'appareil.
 */
import type { FabricName } from '@kwatt/design';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export interface SignupDraft {
  pseudo: string;
  email: string;
  password: string;
  frame: FabricName;
  acceptTerms: boolean;
  /** Année choisie à l'écran 04 (gardée si le joueur revient en arrière). */
  birthYear: number | null;
  /** Où aller à la fin (`?next=` reçu par Bienvenue). */
  next: string | null;
  /** Erreur du serveur à montrer sur l'écran 03 (pseudo pris, adresse déjà utilisée). */
  serverError: { field: 'pseudo' | 'email'; code: string; suggestions: string[] } | null;
}

export const EMPTY_DRAFT: SignupDraft = {
  pseudo: '',
  email: '',
  password: '',
  frame: 'ndop',
  acceptTerms: false,
  birthYear: null,
  next: null,
  serverError: null,
};

export const signupDraftStore = createStore<SignupDraft>()(() => ({ ...EMPTY_DRAFT }));

export function updateSignupDraft(patch: Partial<SignupDraft>): void {
  signupDraftStore.setState(patch);
}

export function resetSignupDraft(): void {
  signupDraftStore.setState({ ...EMPTY_DRAFT });
}

/** Le brouillon a ce qu'il faut pour envoyer l'inscription. */
export function isDraftComplete(d: SignupDraft): boolean {
  return d.pseudo.length > 0 && d.email.length > 0 && d.password.length > 0 && d.acceptTerms;
}

export function useSignupDraft<T>(selector: (d: SignupDraft) => T): T {
  return useStore(signupDraftStore, selector);
}
