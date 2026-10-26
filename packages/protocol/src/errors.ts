/**
 * Codes d'erreur de l'API et du temps réel.
 *
 * Forme d'une erreur REST : HTTP 4xx/5xx + `{ "error": { "code": "auth.invalid_credentials", "params": {} } }`.
 * Forme d'une erreur WebSocket : `{ "t": "error", "re": "<id du message>", "code": "…", "params": {} }`.
 *
 * Pour ajouter des codes : créer `src/errors/<module>.ts` (une liste `as const`, sans import)
 * puis ajouter UNE ligne d'import et UNE ligne dans `ERROR_CODES` ci-dessous.
 * Chaque code est traduit par l'appli (`apps/mobile/src/i18n/locales/{fr,en}/errors.json`).
 */
import { z } from 'zod';
import { ACCOUNT_ERRORS } from './errors/accounts.js';
import { AUTH_ERRORS } from './errors/auth.js';
import { COMMON_ERRORS } from './errors/common.js';
import { DAMES_ERRORS } from './errors/dames.js';
import { ECONOMY_ERRORS } from './errors/economy.js';
import { MEDIA_ERRORS } from './errors/media.js';
import { NOTIFICATION_ERRORS } from './errors/notifications.js';
import { PROFILE_ERRORS } from './errors/profile.js';
import { PROFILES_ERRORS } from './errors/profiles.js';
import { REALTIME_ERRORS } from './errors/realtime.js';
import { SHOP_ERRORS } from './errors/shop.js';
import { ROOM_ERRORS } from './errors/rooms.js';
import { LUDO_ERRORS } from './errors/ludo.js';
import { LEAGUE_ERRORS } from './errors/leagues.js';
import { GAME_ERRORS } from './errors/games.js';
import { FRIEND_ERRORS } from './errors/friends.js';
import { REPORT_ERRORS } from './errors/reports.js';

export const ERROR_CODES = [
  ...COMMON_ERRORS,
  ...AUTH_ERRORS,
  ...PROFILE_ERRORS,
  ...ECONOMY_ERRORS,
  ...NOTIFICATION_ERRORS,
  ...REALTIME_ERRORS,
  ...MEDIA_ERRORS,
  ...PROFILES_ERRORS,
  ...SHOP_ERRORS,
  ...ACCOUNT_ERRORS,
  ...ROOM_ERRORS,
  ...LUDO_ERRORS,
  ...DAMES_ERRORS,
  ...LEAGUE_ERRORS,
  ...GAME_ERRORS,
  ...FRIEND_ERRORS,
  ...REPORT_ERRORS,
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const known: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && known.has(value);
}

/** Valeur JSON autorisée dans les paramètres d'une erreur (jamais une phrase à afficher). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ErrorParams = Record<string, JsonValue>;

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);

/**
 * Corps d'une réponse d'erreur REST.
 * `code` est lu comme une chaîne : une appli plus ancienne que le serveur reçoit peut-être
 * un code qu'elle ne connaît pas et affiche alors un message générique.
 */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    params: z.record(z.string(), JsonValueSchema),
  }),
});
export interface ApiError {
  error: { code: ErrorCode; params: ErrorParams };
}
