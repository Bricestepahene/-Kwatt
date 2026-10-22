/**
 * Sauvegarde des réglages sur le serveur (écran 13 : « Synchronisé il y a 2 min »).
 *
 * Les préférences de l'appareil (@/preferences) restent la source de l'affichage ; pour un
 * profil, elles sont recopiées sur le serveur :
 * - sons, affichage, jeu → PATCH /v1/me/settings (clés ci-dessous) ;
 * - notifications → PUT /v1/notifications/preferences ({ turn, invites, league }) ;
 * - langue → PATCH /v1/me/locale (invités compris : e-mails et notifications dans leur langue).
 *
 * À la connexion (ou au démarrage avec un profil), les réglages du serveur sont repris :
 * « changement de téléphone = reconnexion » (SPEC §6). Exception : une langue choisie sur
 * l'appareil (Bienvenue) l'emporte et part au serveur. Un envoi raté est retenté au retour
 * du réseau ou au prochain changement.
 *
 * Module pur : l'API, les préférences, la session, le stockage et l'horloge sont injectés.
 */
import type { Me, NotificationPreferences as ServerNotificationPreferences, Settings } from '@kwatt/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Language } from '../../i18n/languages';
import {
  sanitizePreferences,
  type NotificationPreferences,
  type Preferences,
  type PreferencesPatch,
} from '../../preferences/preferences';
import { readJson, writeJson, type KeyValueStore } from '../../storage/kv';

/** Clés des réglages gardés dans profiles.settings. */
export const SETTING_KEYS = {
  soundPack: 'sound.pack',
  volume: 'sound.volume',
  vibration: 'sound.vibration',
  theme: 'display.theme',
  boardNumbers: 'dames.boardNumbers',
  autoPlaySingleMove: 'ludo.autoPlaySingleMove',
  diceAnimation: 'ludo.diceAnimation',
} as const satisfies Partial<Record<keyof Preferences, string>>;

type SyncedField = keyof typeof SETTING_KEYS;
const SYNCED_FIELDS = Object.keys(SETTING_KEYS) as SyncedField[];

/** Cadre d'avatar choisi à l'inscription (en attendant le studio d'avatar de l'équipe Profil). */
export const FRAME_SETTING_KEY = 'profile.frame';

export const SYNC_STORAGE_KEY = 'kwatt.accountSync.v1';

export function prefsToServerSettings(prefs: Preferences): Settings {
  const out: Settings = {};
  for (const field of SYNCED_FIELDS) out[SETTING_KEYS[field]] = prefs[field];
  // Volume arrondi : pas de bruit de virgule flottante dans la base.
  out[SETTING_KEYS.volume] = Math.round(prefs.volume * 100) / 100;
  return out;
}

/** Réglages du serveur → préférences (valeurs invalides ou absentes ignorées). */
export function serverSettingsToPatch(settings: Settings, current: Preferences): PreferencesPatch {
  const raw: Record<string, unknown> = { ...current };
  const present: SyncedField[] = [];
  for (const field of SYNCED_FIELDS) {
    const value = settings[SETTING_KEYS[field]];
    if (value !== undefined && value !== null) {
      raw[field] = value;
      present.push(field);
    }
  }
  const clean = sanitizePreferences(raw);
  const patch: Record<string, unknown> = {};
  for (const field of present) patch[field] = clean[field];
  return patch as PreferencesPatch;
}

export function notificationsToServer(n: NotificationPreferences): ServerNotificationPreferences {
  return { turn: n.yourTurn, invites: n.roomInvites, league: n.leagueMatches };
}

export function notificationsFromServer(n: ServerNotificationPreferences): NotificationPreferences {
  return { yourTurn: n.turn, roomInvites: n.invites, leagueMatches: n.league };
}

/** Empreinte de ce qui part au serveur : un changement d'autre chose n'envoie rien. */
export function syncedSignature(prefs: Preferences): string {
  return JSON.stringify([prefsToServerSettings(prefs), notificationsToServer(prefs.notifications)]);
}

export interface SyncApi {
  getMe(): Promise<Me>;
  patchSettings(settings: Settings): Promise<unknown>;
  getNotificationPreferences(): Promise<ServerNotificationPreferences>;
  putNotificationPreferences(prefs: ServerNotificationPreferences): Promise<unknown>;
  patchLocale(locale: Language): Promise<Me>;
}

export interface SyncSession {
  status: 'loading' | 'signedOut' | 'guest' | 'member';
  userId: string | null;
}

export interface SyncDeps {
  api: SyncApi;
  getPrefs(): Preferences;
  /** Applique des préférences venues du serveur (sans les renvoyer). */
  applyPrefs(patch: PreferencesPatch): void;
  subscribePrefs(listener: (prefs: Preferences, previous: Preferences) => void): () => void;
  getSession(): SyncSession;
  subscribeSession(listener: (session: SyncSession, previous: SyncSession) => void): () => void;
  /** Langue reçue du serveur, à appliquer à l'appli. */
  applyLanguage(language: Language): void | Promise<void>;
  /** Profil relu (gardé dans la session). */
  onMe?(me: Me): void | Promise<void>;
  storage: KeyValueStore;
  now(): number;
  debounceMs?: number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export type SyncStatus = 'idle' | 'syncing' | 'failed';

export interface SyncState {
  /** Dernière synchronisation réussie (ms), ou null. */
  lastSyncAt: number | null;
  /** Des changements de l'appareil attendent d'être envoyés. */
  pending: boolean;
  status: SyncStatus;
}

interface Persisted {
  userId: string | null;
  lastSyncAt: number | null;
  pending: boolean;
  pendingLocale: boolean;
}

export interface AccountSync {
  state: StoreApi<SyncState>;
  start(): Promise<void>;
  stop(): void;
  /** Envoie tout de suite ce qui attend (retour du réseau, bouton « Réessayer »). */
  flush(): Promise<void>;
  /** Relit les réglages du serveur. */
  pull(): Promise<void>;
}

export function createAccountSync(deps: SyncDeps): AccountSync {
  const debounceMs = deps.debounceMs ?? 1500;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const state = createStore<SyncState>()(() => ({ lastSyncAt: null, pending: false, status: 'idle' }));
  let persisted: Persisted = { userId: null, lastSyncAt: null, pending: false, pendingLocale: false };
  let applying = false;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  const unsubscribers: Array<() => void> = [];

  const save = () => writeJson(deps.storage, SYNC_STORAGE_KEY, persisted).catch(() => undefined);
  const publish = (patch: Partial<SyncState>) => {
    state.setState({ lastSyncAt: persisted.lastSyncAt, pending: persisted.pending || persisted.pendingLocale, ...patch });
  };
  const update = (patch: Partial<Persisted>) => {
    persisted = { ...persisted, ...patch };
    void save();
    publish({});
  };

  /** Une seule opération à la fois ; la suivante attend la précédente. */
  const serial = (task: () => Promise<void>): Promise<void> => {
    const next = (running ?? Promise.resolve()).then(task, task);
    running = next.finally(() => {
      if (running === next) running = null;
    });
    return next;
  };

  const session = () => deps.getSession();

  async function pushNow(): Promise<void> {
    const s = session();
    if (s.status !== 'member' && s.status !== 'guest') return;
    if (!persisted.pending && !persisted.pendingLocale) return;
    publish({ status: 'syncing' });
    try {
      const prefs = deps.getPrefs();
      if (persisted.pendingLocale && prefs.language) {
        await deps.api.patchLocale(prefs.language);
        update({ pendingLocale: false });
      }
      if (s.status === 'member' && persisted.pending) {
        await deps.api.patchSettings(prefsToServerSettings(prefs));
        await deps.api.putNotificationPreferences(notificationsToServer(prefs.notifications));
        update({ pending: false, lastSyncAt: deps.now() });
      } else if (s.status === 'guest') {
        update({ pending: false });
      }
      publish({ status: 'idle' });
    } catch {
      publish({ status: 'failed' });
    }
  }

  async function pullNow(): Promise<void> {
    const s = session();
    if (s.status !== 'member') return;
    publish({ status: 'syncing' });
    try {
      const me = await deps.api.getMe();
      await deps.onMe?.(me);
      const notifications = await deps.api.getNotificationPreferences();
      applying = true;
      try {
        const prefs = deps.getPrefs();
        deps.applyPrefs({ ...serverSettingsToPatch(me.settings, prefs), notifications: notificationsFromServer(notifications) });
      } finally {
        applying = false;
      }
      // Langue : un choix fait sur l'appareil l'emporte ; sinon celle du profil.
      if (deps.getPrefs().language === null) {
        applying = true;
        try {
          await deps.applyLanguage(me.locale);
        } finally {
          applying = false;
        }
      } else if (deps.getPrefs().language !== me.locale) update({ pendingLocale: true });
      update({ lastSyncAt: deps.now() });
      publish({ status: 'idle' });
      if (persisted.pendingLocale) await pushNow();
    } catch {
      publish({ status: 'failed' });
    }
  }

  const schedule = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void serial(pushNow);
    }, debounceMs);
  };

  function onPrefs(prefs: Preferences, previous: Preferences) {
    if (applying) return;
    const s = session();
    if (s.status !== 'member' && s.status !== 'guest') return;
    let changed = false;
    if (prefs.language !== previous.language && prefs.language !== null) {
      persisted = { ...persisted, pendingLocale: true };
      changed = true;
    }
    if (s.status === 'member' && syncedSignature(prefs) !== syncedSignature(previous)) {
      persisted = { ...persisted, pending: true };
      changed = true;
    }
    if (!changed) return;
    void save();
    publish({});
    schedule();
  }

  function onSession(next: SyncSession, previous: SyncSession) {
    if (next.status === previous.status && next.userId === previous.userId) return;
    if (next.status === 'signedOut') {
      update({ userId: null, lastSyncAt: null, pending: false, pendingLocale: false });
      return;
    }
    if (next.status === 'member' || next.status === 'guest') {
      const sameUser = persisted.userId === next.userId;
      if (!sameUser) update({ userId: next.userId, lastSyncAt: null, pending: false, pendingLocale: deps.getPrefs().language !== null });
      void serial(async () => {
        // Des changements de l'appareil attendent : ils partent d'abord, puis on relit.
        if (sameUser && (persisted.pending || persisted.pendingLocale)) await pushNow();
        if (next.status === 'member') await pullNow();
        else await pushNow();
      });
    }
  }

  return {
    state,
    async start() {
      const raw = (await readJson(deps.storage, SYNC_STORAGE_KEY)) as Partial<Persisted> | null;
      if (raw && typeof raw === 'object') {
        persisted = {
          userId: typeof raw.userId === 'string' ? raw.userId : null,
          lastSyncAt: typeof raw.lastSyncAt === 'number' ? raw.lastSyncAt : null,
          pending: raw.pending === true,
          pendingLocale: raw.pendingLocale === true,
        };
      }
      publish({});
      unsubscribers.push(deps.subscribePrefs(onPrefs));
      unsubscribers.push(deps.subscribeSession(onSession));
      onSession(session(), { status: 'loading', userId: null });
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      for (const off of unsubscribers.splice(0)) off();
    },
    flush: () => serial(pushNow),
    pull: () => serial(pullNow),
  };
}
