/**
 * Types du contrat REST et temps réel côté appli (SPEC §9). Les réponses du serveur
 * viennent de @kwatt/protocol (AuthSessionResponse, Me…) ; restent ici la forme de la
 * session gardée sur l'appareil et quelques types de la fondation.
 */
import type { AuthSessionResponse, Me } from '@kwatt/protocol';
import type { Language } from '../i18n/languages';

/**
 * Codes d'erreur connus de l'appli. Le serveur peut en envoyer d'autres : chacun se
 * traduit par `errors:<code>` (repli sur `errors:generic`).
 */
export type KnownErrorCode =
  | 'generic'
  | 'network.offline'
  | 'network.timeout'
  | 'network.server'
  | 'network.bad_response'
  | 'auth.invalid_credentials'
  | 'auth.session_expired'
  | 'auth.unauthorized'
  | 'auth.forbidden'
  | 'auth.member_required'
  | 'auth.adult_required'
  | 'auth.email_not_verified'
  | 'auth.code_invalid'
  | 'auth.code_expired'
  | 'auth.too_many_attempts'
  | 'validation.invalid'
  | 'room.not_found'
  | 'room.full'
  | 'room.started'
  | 'rate_limited'
  | 'not_found';

export type ErrorCode = KnownErrorCode | (string & {});

/** Corps d'une réponse d'erreur : `{ "error": { "code": "…", "params": {} } }`. */
export interface ApiErrorBody {
  error: { code: ErrorCode; params?: Record<string, unknown> };
}

/** Page d'une liste : `?cursor=…&limit=…` → `{ items, nextCursor }`. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Tranche d'âge (écran 04) : moins de 13 ans, 13–17, 18 et plus. */
export type AgeBand = 'child' | 'teen' | 'adult';

/** Joueur connecté, tel que l'appli le garde (le serveur fait foi). */
export interface SessionUser {
  id: string;
  kind: 'guest' | 'member';
  pseudo: string | null;
  ageBand: AgeBand | null;
  emailVerified: boolean;
  locale?: Language;
}

/**
 * Jetons reçus des routes d'authentification (connexion, inscription, invité, renouvellement) :
 * `AuthSessionResponse` de @kwatt/protocol, lu avec tolérance (le renouvellement n'exige que
 * les deux jetons).
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Fin de validité du jeton d'accès (ISO 8601), donnée par le serveur. */
  accessTokenExpiresAt?: string;
  /** Durée de vie du jeton d'accès, en secondes (ancien format, gardé pour compatibilité). */
  expiresIn?: number;
  /** Profil à jour, joint par le serveur. */
  me?: Me;
}

/** Réponse complète d'une connexion, d'une inscription ou d'une session invitée. */
export type AuthResponse = AuthSessionResponse;

/** Message de l'appli vers le serveur : `{ t, id?, ...données }`. */
export interface WsClientMessage {
  t: string;
  id?: string;
  [field: string]: unknown;
}

/** Message du serveur : `{ t, re?, ...données }` ; `re` = `id` du message auquel il répond. */
export interface WsServerMessage {
  t: string;
  re?: string;
  [field: string]: unknown;
}

/** Erreur temps réel : `{ t: 'error', re, code, params }`. */
export interface WsErrorMessage extends WsServerMessage {
  t: 'error';
  code: ErrorCode;
  params?: Record<string, unknown>;
}

/** Chemins REST utilisés par la fondation (les modules ajoutent les leurs). */
export const API_PATHS = {
  refresh: '/v1/auth/refresh',
  guest: '/v1/auth/guest',
  logout: '/v1/auth/logout',
} as const;
