import type { Me, NotificationPreferences as ServerNotificationPreferences, Settings } from '@kwatt/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { Language } from '../../i18n/languages';
import { createPreferencesStore, DEFAULT_PREFERENCES, sanitizePreferences } from '../../preferences/preferences';
import { memoryStore } from '../../storage/kv';
import { createStore } from 'zustand/vanilla';
import {
  createAccountSync,
  notificationsFromServer,
  notificationsToServer,
  prefsToServerSettings,
  serverSettingsToPatch,
  SETTING_KEYS,
  type SyncSession,
} from './settingsSync';

const ME: Me = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'member',
  pseudo: 'brice_237',
  email: 'brice@example.com',
  emailVerified: true,
  locale: 'en',
  ageGroup: 'adult',
  permissions: { canStake: true, canPredict: true, canJoinPaidLeagues: true, canCreate: true, visibleToStrangers: true },
  pseudoChangeAvailableAt: null,
  deletionRequestedAt: null,
  deletionScheduledFor: null,
  settings: {},
  createdAt: '2026-01-15T08:00:00.000Z',
};

function harness(options: { me?: Partial<Me>; notifications?: ServerNotificationPreferences; failPatch?: boolean } = {}) {
  let now = 1_000_000;
  const server = {
    settings: { ...(options.me?.settings ?? {}) } as Settings,
    notifications: options.notifications ?? { turn: true, invites: true, league: true },
    locale: (options.me?.locale ?? 'en') as Language,
    failPatch: options.failPatch ?? false,
  };
  const api = {
    getMe: vi.fn(async () => ({ ...ME, ...options.me, settings: server.settings, locale: server.locale })),
    patchSettings: vi.fn(async (s: Settings) => {
      if (server.failPatch) throw new Error('offline');
      server.settings = { ...server.settings, ...s };
      return { settings: server.settings };
    }),
    getNotificationPreferences: vi.fn(async () => server.notifications),
    putNotificationPreferences: vi.fn(async (n: ServerNotificationPreferences) => {
      server.notifications = n;
      return n;
    }),
    patchLocale: vi.fn(async (locale: Language) => {
      server.locale = locale;
      return { ...ME, locale };
    }),
  };
  const prefs = createPreferencesStore(memoryStore());
  const session = createStore<SyncSession>()(() => ({ status: 'signedOut', userId: null }));
  const timers: Array<() => void> = [];
  const applyLanguage = vi.fn((language: Language) => prefs.getState().update({ language }));
  const sync = createAccountSync({
    api,
    getPrefs: () => prefs.getState().prefs,
    applyPrefs: (patch) => prefs.getState().update(patch),
    subscribePrefs: (listener) => prefs.subscribe((s, p) => listener(s.prefs, p.prefs)),
    getSession: () => session.getState(),
    subscribeSession: (listener) => session.subscribe(listener),
    applyLanguage,
    storage: memoryStore(),
    now: () => now,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => undefined,
  });
  return {
    api,
    prefs,
    session,
    server,
    sync,
    applyLanguage,
    tick: (ms: number) => (now += ms),
    /** Déclenche les envois différés et attend la fin des opérations. */
    async flushTimers() {
      for (const fn of timers.splice(0)) fn();
      await sync.flush();
    },
  };
}

describe('réglages ↔ serveur', () => {
  it('fait l’aller-retour sans perte', () => {
    const prefs = sanitizePreferences({ ...DEFAULT_PREFERENCES, soundPack: 'tamtam', volume: 0.3333, theme: 'auto', diceAnimation: 'fast' });
    const settings = prefsToServerSettings(prefs);
    expect(settings).toMatchObject({ [SETTING_KEYS.soundPack]: 'tamtam', [SETTING_KEYS.volume]: 0.33, [SETTING_KEYS.theme]: 'auto' });
    expect(serverSettingsToPatch(settings, sanitizePreferences(DEFAULT_PREFERENCES))).toMatchObject({
      soundPack: 'tamtam',
      volume: 0.33,
      theme: 'auto',
      diceAnimation: 'fast',
    });
  });

  it('ignore les valeurs absentes ou invalides du serveur', () => {
    const current = sanitizePreferences(DEFAULT_PREFERENCES);
    expect(serverSettingsToPatch({ [SETTING_KEYS.soundPack]: 'trompette', other: 'x' }, current)).toEqual({ soundPack: 'balafon' });
    expect(serverSettingsToPatch({}, current)).toEqual({});
  });

  it('traduit les préférences de notification', () => {
    const local = { yourTurn: false, roomInvites: true, leagueMatches: false };
    expect(notificationsToServer(local)).toEqual({ turn: false, invites: true, league: false });
    expect(notificationsFromServer(notificationsToServer(local))).toEqual(local);
  });
});

describe('synchronisation', () => {
  it('à la connexion d’un profil, reprend les réglages et la langue du serveur', async () => {
    const h = harness({
      me: { settings: { [SETTING_KEYS.soundPack]: 'silence', [SETTING_KEYS.boardNumbers]: true }, locale: 'en' },
      notifications: { turn: false, invites: true, league: true },
    });
    await h.sync.start();
    h.session.setState({ status: 'member', userId: ME.id });
    await h.sync.pull();
    const prefs = h.prefs.getState().prefs;
    expect(prefs.soundPack).toBe('silence');
    expect(prefs.boardNumbers).toBe(true);
    expect(prefs.notifications.yourTurn).toBe(false);
    expect(h.applyLanguage).toHaveBeenCalledWith('en');
    expect(h.sync.state.getState()).toMatchObject({ lastSyncAt: 1_000_000, pending: false, status: 'idle' });
    // Rien n'est renvoyé : ce sont les valeurs du serveur.
    await h.flushTimers();
    expect(h.api.patchSettings).not.toHaveBeenCalled();
    expect(h.api.patchLocale).not.toHaveBeenCalled();
  });

  it('une langue choisie sur l’appareil avant la connexion l’emporte', async () => {
    const h = harness({ me: { locale: 'fr' } });
    h.prefs.getState().update({ language: 'en' });
    await h.sync.start();
    h.session.setState({ status: 'member', userId: ME.id });
    await h.sync.pull();
    expect(h.applyLanguage).not.toHaveBeenCalled();
    expect(h.api.patchLocale).toHaveBeenCalledWith('en');
    expect(h.server.locale).toBe('en');
  });

  it('envoie les changements d’un profil, puis note l’heure', async () => {
    const h = harness();
    await h.sync.start();
    h.session.setState({ status: 'member', userId: ME.id });
    await h.sync.pull();
    h.tick(120_000);
    h.prefs.getState().update({ soundPack: 'tamtam', notifications: { leagueMatches: false } });
    expect(h.sync.state.getState().pending).toBe(true);
    await h.flushTimers();
    expect(h.server.settings[SETTING_KEYS.soundPack]).toBe('tamtam');
    expect(h.server.notifications).toEqual({ turn: true, invites: true, league: false });
    expect(h.sync.state.getState()).toMatchObject({ pending: false, lastSyncAt: 1_120_000, status: 'idle' });
  });

  it('garde un envoi raté pour plus tard', async () => {
    const h = harness();
    await h.sync.start();
    h.session.setState({ status: 'member', userId: ME.id });
    await h.sync.pull();
    h.server.failPatch = true;
    h.prefs.getState().update({ vibration: false });
    await h.flushTimers();
    expect(h.sync.state.getState()).toMatchObject({ pending: true, status: 'failed' });
    h.server.failPatch = false;
    await h.sync.flush();
    expect(h.server.settings[SETTING_KEYS.vibration]).toBe(false);
    expect(h.sync.state.getState()).toMatchObject({ pending: false, status: 'idle' });
  });

  it('un invité n’envoie que sa langue ; sans session, rien ne part', async () => {
    const h = harness();
    await h.sync.start();
    h.prefs.getState().update({ soundPack: 'silence', language: 'en' });
    await h.flushTimers();
    expect(h.api.patchLocale).not.toHaveBeenCalled();

    h.session.setState({ status: 'guest', userId: 'invite' });
    await h.flushTimers();
    h.prefs.getState().update({ language: 'fr', soundPack: 'tamtam' });
    await h.flushTimers();
    expect(h.api.patchLocale).toHaveBeenLastCalledWith('fr');
    expect(h.api.patchSettings).not.toHaveBeenCalled();
    expect(h.api.getMe).not.toHaveBeenCalled();
  });

  it('oublie tout à la déconnexion', async () => {
    const h = harness();
    await h.sync.start();
    h.session.setState({ status: 'member', userId: ME.id });
    await h.sync.pull();
    h.session.setState({ status: 'signedOut', userId: null });
    expect(h.sync.state.getState()).toMatchObject({ lastSyncAt: null, pending: false });
  });
});
