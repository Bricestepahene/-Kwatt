/**
 * Session du joueur : jetons (accès 15 min, renouvellement 30 jours, SPEC §6) et
 * profil minimal. Gardée dans le stockage sûr de l'appareil (expo-secure-store).
 * Module pur : le stockage est injecté ; testé par vitest.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AccessSession } from '../navigation/access';
import { readJson, STORAGE_KEYS, writeJson, type KeyValueStore } from '../storage/kv';
import type { Me } from '@kwatt/protocol';
import type { AuthResponse, AuthTokens, SessionUser } from '../api/types';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Fin de validité du jeton d'accès (ms depuis 1970). */
  accessExpiresAt: number;
}

export interface SessionData {
  tokens: Tokens;
  user: SessionUser;
}

export type SessionStatus = 'loading' | 'signedOut' | 'guest' | 'member';

export interface SessionState {
  status: SessionStatus;
  data: SessionData | null;
  hydrate(): Promise<void>;
  /** Nouvelle session (connexion, inscription, invité, mot de passe réinitialisé). */
  signIn(response: AuthResponse): Promise<void>;
  /** Jetons renouvelés (avec le profil à jour quand le serveur le joint). */
  setTokens(tokens: AuthTokens): Promise<void>;
  updateUser(patch: Partial<SessionUser>): Promise<void>;
  /** Profil relu sur le serveur (GET /v1/me, vérification de l'e-mail…). */
  applyMe(me: Me): Promise<void>;
  signOut(): Promise<void>;
}

export type SessionStore = StoreApi<SessionState>;

/** Durée par défaut du jeton d'accès si le serveur ne la donne pas (SPEC §6 : 15 min). */
export const DEFAULT_ACCESS_TTL_S = 15 * 60;

/** Date d'expiration lue dans le jeton JWT (`exp`), sinon `null`. */
export function jwtExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = typeof atob === 'function' ? atob(padded) : '';
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function tokensFrom(response: AuthTokens, now: number): Tokens {
  const fromTtl = typeof response.expiresIn === 'number' ? now + response.expiresIn * 1000 : null;
  const at = typeof response.accessTokenExpiresAt === 'string' ? Date.parse(response.accessTokenExpiresAt) : NaN;
  const fromDate = Number.isFinite(at) ? at : null;
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    accessExpiresAt: fromTtl ?? fromDate ?? jwtExpiry(response.accessToken) ?? now + DEFAULT_ACCESS_TTL_S * 1000,
  };
}

/** Joueur gardé sur l'appareil, tiré du profil du serveur (`Me` de @kwatt/protocol). */
export function userFromMe(me: Me): SessionUser {
  return {
    id: me.id,
    kind: me.kind,
    pseudo: me.pseudo,
    ageBand: me.ageGroup,
    emailVerified: me.emailVerified,
    locale: me.locale,
  };
}

function isSessionData(value: unknown): value is SessionData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SessionData>;
  const t = v.tokens as Partial<Tokens> | undefined;
  const u = v.user as Partial<SessionUser> | undefined;
  return (
    typeof t?.accessToken === 'string' &&
    typeof t.refreshToken === 'string' &&
    typeof t.accessExpiresAt === 'number' &&
    typeof u?.id === 'string' &&
    (u.kind === 'guest' || u.kind === 'member')
  );
}

function statusOf(data: SessionData | null): SessionStatus {
  if (!data) return 'signedOut';
  return data.user.kind === 'member' ? 'member' : 'guest';
}

/** Vue de la session pour la garde de navigation. */
export function accessSessionOf(state: Pick<SessionState, 'status' | 'data'>): AccessSession {
  const status = state.status === 'member' || state.status === 'guest' ? state.status : 'signedOut';
  return { status, isAdult: state.data?.user.ageBand === 'adult' };
}

export function createSessionStore(storage: KeyValueStore, now: () => number = Date.now): SessionStore {
  return createStore<SessionState>()((set, get) => {
    const save = async (data: SessionData | null) => {
      if (data) await writeJson(storage, STORAGE_KEYS.session, data);
      else await storage.removeItem(STORAGE_KEYS.session);
    };
    return {
      status: 'loading',
      data: null,
      async hydrate() {
        const raw = await readJson(storage, STORAGE_KEYS.session);
        const data = isSessionData(raw) ? raw : null;
        set({ data, status: statusOf(data) });
      },
      async signIn(response) {
        const data: SessionData = { tokens: tokensFrom(response, now()), user: userFromMe(response.me) };
        set({ data, status: statusOf(data) });
        await save(data);
      },
      async setTokens(tokens) {
        const current = get().data;
        if (!current) return;
        // Le renouvellement joint le profil : il suit (vérification de l'e-mail faite ailleurs…).
        const user = tokens.me && tokens.me.id === current.user.id ? userFromMe(tokens.me) : current.user;
        const data: SessionData = { tokens: tokensFrom(tokens, now()), user };
        set({ data, status: statusOf(data) });
        await save(data);
      },
      async applyMe(me) {
        const current = get().data;
        if (!current || current.user.id !== me.id) return;
        const data: SessionData = { ...current, user: userFromMe(me) };
        set({ data, status: statusOf(data) });
        await save(data);
      },
      async updateUser(patch) {
        const current = get().data;
        if (!current) return;
        const data: SessionData = { ...current, user: { ...current.user, ...patch } };
        set({ data, status: statusOf(data) });
        await save(data);
      },
      async signOut() {
        set({ data: null, status: 'signedOut' });
        await save(null);
      },
    };
  });
}
