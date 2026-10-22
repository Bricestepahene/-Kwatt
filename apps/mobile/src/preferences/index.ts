/**
 * Préférences de l'appli (store unique, gardé dans AsyncStorage).
 *
 *   const theme = usePreferences((p) => p.theme);
 *   updatePreferences({ soundPack: 'tamtam' });
 */
import { useStore } from 'zustand';
import { localStorage } from '../storage/deviceStorage';
import { createPreferencesStore, type Preferences, type PreferencesPatch } from './preferences';

export * from './preferences';

export const preferencesStore = createPreferencesStore(localStorage);

export function usePreferences<T>(selector: (prefs: Preferences) => T): T {
  return useStore(preferencesStore, (state) => selector(state.prefs));
}

export function usePreferencesHydrated(): boolean {
  return useStore(preferencesStore, (state) => state.hydrated);
}

export function updatePreferences(patch: PreferencesPatch): void {
  preferencesStore.getState().update(patch);
}

export function getPreferences(): Preferences {
  return preferencesStore.getState().prefs;
}
