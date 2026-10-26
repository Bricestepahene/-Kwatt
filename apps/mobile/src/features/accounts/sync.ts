/**
 * Instance de la synchronisation des réglages (settingsSync.ts), reliée à l'appli :
 * préférences, session, langue, réseau, premier plan. Démarrée par useBootstrap.
 */
import { AppState } from 'react-native';
import { useStore } from 'zustand';
import { setAppLanguage } from '../../i18n';
import { networkStore } from '../../offline/network';
import { getPreferences, preferencesStore } from '../../preferences';
import { sessionStore, type SessionState } from '../../session';
import { localStorage } from '../../storage/deviceStorage';
import { accountsApi } from './api';
import { registerPushToken } from './push';
import { rememberMe } from './session';
import { createAccountSync, type SyncSession, type SyncState } from './settingsSync';

const sessionView = (s: Pick<SessionState, 'status' | 'data'>): SyncSession => ({ status: s.status, userId: s.data?.user.id ?? null });

export const accountSync = createAccountSync({
  api: {
    getMe: () => accountsApi.me(),
    patchSettings: (settings) => accountsApi.patchSettings(settings),
    getNotificationPreferences: () => accountsApi.notificationPreferences(),
    putNotificationPreferences: (prefs) => accountsApi.putNotificationPreferences(prefs),
    patchLocale: (locale) => accountsApi.changeLocale(locale),
  },
  getPrefs: getPreferences,
  applyPrefs: (patch) => preferencesStore.getState().update(patch),
  subscribePrefs: (listener) => preferencesStore.subscribe((state, previous) => listener(state.prefs, previous.prefs)),
  getSession: () => sessionView(sessionStore.getState()),
  subscribeSession: (listener) => sessionStore.subscribe((state, previous) => listener(sessionView(state), sessionView(previous))),
  applyLanguage: (language) => setAppLanguage(language),
  onMe: rememberMe,
  storage: localStorage,
  now: Date.now,
});

export function useAccountSync<T>(selector: (state: SyncState) => T): T {
  return useStore(accountSync.state, selector);
}

let started = false;

/** Démarre la synchronisation (une fois) ; rend la fonction d'arrêt. */
export function startAccountSync(): () => void {
  if (started) return () => undefined;
  started = true;
  void accountSync.start();
  // Profil déjà connecté au démarrage : le jeton push peut avoir changé.
  if (sessionStore.getState().status === 'member') void registerPushToken();
  const offNetwork = networkStore.subscribe((state, previous) => {
    if (state.isOnline && previous.isOnline === false) void accountSync.flush();
  });
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') void accountSync.flush();
  });
  return () => {
    started = false;
    accountSync.stop();
    offNetwork();
    appState.remove();
  };
}
