/**
 * Préférences du joueur, gardées sur l'appareil (écran 13 · Paramètres).
 * Module pur : le store reçoit son stockage ; testé par vitest.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { isLanguage, type Language } from '../i18n/languages';
import { readJson, STORAGE_KEYS, writeJson, type KeyValueStore } from '../storage/kv';

/** Famille de sons du plateau (Balafon par défaut, Tam-tam, Silence). */
export type SoundPack = 'balafon' | 'tamtam' | 'silence';
/** Affichage : Nuit (défaut), Plein soleil, Automatique (SPEC §5). */
export type ThemeSetting = 'night' | 'sun' | 'auto';
export type DiceAnimation = 'normal' | 'fast' | 'none';
/** Espace de jeu rouvert par l'onglet « Jouer ». */
export type PlaySpace = 'dames' | 'ludo';

export interface NotificationPreferences {
  yourTurn: boolean;
  roomInvites: boolean;
  leagueMatches: boolean;
}

export interface Preferences {
  soundPack: SoundPack;
  /** Volume des effets, de 0 à 1. */
  volume: number;
  /** Vibration à la prise (et au coup refusé). */
  vibration: boolean;
  theme: ThemeSetting;
  /** Dames : numéros des cases. */
  boardNumbers: boolean;
  /** Ludo : jouer seul le coup unique (activé par défaut, SPEC §10). */
  autoPlaySingleMove: boolean;
  diceAnimation: DiceAnimation;
  notifications: NotificationPreferences;
  /** `null` tant que le joueur n'a pas choisi : on suit la langue de l'appareil. */
  language: Language | null;
  lastSpace: PlaySpace;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  soundPack: 'balafon',
  volume: 0.7,
  vibration: true,
  theme: 'night',
  boardNumbers: false,
  autoPlaySingleMove: true,
  diceAnimation: 'normal',
  notifications: Object.freeze({ yourTurn: true, roomInvites: true, leagueMatches: true }),
  language: null,
  lastSpace: 'dames',
});

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Valide des préférences lues sur l'appareil : chaque champ invalide reprend sa valeur par défaut. */
export function sanitizePreferences(raw: unknown): Preferences {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (r.notifications && typeof r.notifications === 'object' ? r.notifications : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFERENCES;
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : d.volume;
  return {
    soundPack: pick(r.soundPack, ['balafon', 'tamtam', 'silence'], d.soundPack),
    volume,
    vibration: bool(r.vibration, d.vibration),
    theme: pick(r.theme, ['night', 'sun', 'auto'], d.theme),
    boardNumbers: bool(r.boardNumbers, d.boardNumbers),
    autoPlaySingleMove: bool(r.autoPlaySingleMove, d.autoPlaySingleMove),
    diceAnimation: pick(r.diceAnimation, ['normal', 'fast', 'none'], d.diceAnimation),
    notifications: {
      yourTurn: bool(n.yourTurn, d.notifications.yourTurn),
      roomInvites: bool(n.roomInvites, d.notifications.roomInvites),
      leagueMatches: bool(n.leagueMatches, d.notifications.leagueMatches),
    },
    language: isLanguage(r.language) ? r.language : null,
    lastSpace: pick(r.lastSpace, ['dames', 'ludo'], d.lastSpace),
  };
}

export type PreferencesPatch = Partial<Omit<Preferences, 'notifications'>> & {
  notifications?: Partial<NotificationPreferences>;
};

export interface PreferencesState {
  prefs: Preferences;
  /** Vrai une fois les préférences lues sur l'appareil. */
  hydrated: boolean;
  hydrate(): Promise<void>;
  update(patch: PreferencesPatch): void;
  reset(): void;
}

export type PreferencesStore = StoreApi<PreferencesState>;

export function createPreferencesStore(storage: KeyValueStore): PreferencesStore {
  const persist = (prefs: Preferences) => {
    void writeJson(storage, STORAGE_KEYS.preferences, prefs).catch(() => undefined);
  };

  return createStore<PreferencesState>()((set, get) => ({
    prefs: sanitizePreferences(DEFAULT_PREFERENCES),
    hydrated: false,
    async hydrate() {
      const raw = await readJson(storage, STORAGE_KEYS.preferences);
      set({ prefs: sanitizePreferences(raw ?? DEFAULT_PREFERENCES), hydrated: true });
    },
    update(patch) {
      const current = get().prefs;
      const next = sanitizePreferences({
        ...current,
        ...patch,
        notifications: { ...current.notifications, ...patch.notifications },
      });
      set({ prefs: next });
      persist(next);
    },
    reset() {
      const next = sanitizePreferences(DEFAULT_PREFERENCES);
      set({ prefs: next });
      persist(next);
    },
  }));
}
