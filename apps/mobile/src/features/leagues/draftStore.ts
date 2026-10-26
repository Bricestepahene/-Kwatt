/**
 * Brouillon de la ligue en cours de création, partagé par les écrans 28, 28b et 31
 * (en mémoire : il ne survit pas à la fermeture de l'appli).
 */
import { createStore, useStore } from 'zustand';
import { defaultDraft, type LeagueDraft } from './logic';

interface DraftState {
  draft: LeagueDraft;
}

export const draftStore = createStore<DraftState>()(() => ({ draft: defaultDraft('private', Date.now()) }));

export function useLeagueDraft(): LeagueDraft {
  return useStore(draftStore, (s) => s.draft);
}

export function setLeagueDraft(update: LeagueDraft | ((d: LeagueDraft) => LeagueDraft)): void {
  draftStore.setState((s) => ({ draft: typeof update === 'function' ? update(s.draft) : update }));
}

/** Repart d'un brouillon neuf pour une ligue privée ou publique (garde le nom et le jeu). */
export function startDraft(access: 'private' | 'public'): void {
  const { draft } = draftStore.getState();
  if (draft.access === access) return;
  setLeagueDraft({ ...defaultDraft(access, Date.now(), draft.game), name: draft.name });
}
