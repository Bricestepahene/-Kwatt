/**
 * Erreurs de l'API, typées par code (SPEC §9). Le serveur n'envoie jamais de phrase :
 * l'appli traduit `errors:<code>` dans la langue de son joueur.
 */
import type { ErrorCode } from './types';

export class ApiError extends Error {
  readonly code: ErrorCode;
  /** Statut HTTP (0 : pas de réponse, réseau absent ou délai dépassé). */
  readonly status: number;
  readonly params: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, status: number, params: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.params = params;
  }

  /** Erreur réseau ou serveur indisponible : on peut réessayer plus tard. */
  get isTransient(): boolean {
    return this.status === 0 || this.status >= 500 || this.code === 'rate_limited';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Code d'erreur de repli selon le statut HTTP, quand le corps n'en donne pas. */
export function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'auth.unauthorized';
  if (status === 403) return 'auth.forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'network.server';
  return 'generic';
}

/** Convertit n'importe quelle erreur en ApiError (code « generic » si inconnue). */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  return new ApiError('generic', 0, {}, { cause: error });
}

/** Fonction de traduction minimale avec `exists` (compatible i18next). */
export interface ErrorTranslator {
  t: (key: string, options?: Record<string, unknown>) => string;
  exists: (key: string) => boolean;
}

/** Message traduit d'une erreur, avec repli sur `errors:generic`. */
export function errorMessage(i18n: ErrorTranslator, error: unknown): string {
  const apiError = toApiError(error);
  const key = `errors:${apiError.code}`;
  return i18n.exists(key) ? i18n.t(key, { ...apiError.params }) : i18n.t('errors:generic');
}
