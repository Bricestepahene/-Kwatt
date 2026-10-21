/**
 * Erreurs de l'API : `throw new AppError('auth.invalid_credentials', 401)` devient
 * HTTP 401 + `{ "error": { "code": "auth.invalid_credentials", "params": {} } }`.
 * Le serveur n'envoie jamais de phrase : l'appli traduit le code.
 */
import type { ErrorCode, ErrorParams } from '@kwatt/protocol';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number = 400,
    readonly params: ErrorParams = {},
  ) {
    super(code);
    this.name = 'AppError';
  }

  toBody(): { error: { code: ErrorCode; params: ErrorParams } } {
    return { error: { code: this.code, params: this.params } };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** Statut HTTP d'une erreur Fastify (ou d'une erreur quelconque). */
function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const s = (err as { statusCode: unknown }).statusCode;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

/** Convertit n'importe quelle erreur en AppError (les 5xx inattendues deviennent common.internal). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const status = statusOf(err);
  if (status === undefined || status >= 500) return new AppError('common.internal', 500);
  switch (status) {
    case 404:
      return new AppError('common.not_found', 404);
    case 413:
      return new AppError('common.payload_too_large', 413);
    case 415:
      return new AppError('common.unsupported_media_type', 415);
    case 429:
      return new AppError('common.rate_limited', 429);
    case 401:
      return new AppError('auth.required', 401);
    case 403:
      return new AppError('common.forbidden', 403);
    default:
      return new AppError('common.bad_request', status >= 400 && status < 500 ? status : 400);
  }
}
