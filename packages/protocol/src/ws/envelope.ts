/**
 * Enveloppe des messages temps réel (SPEC §9).
 *
 * Une connexion par appli : `GET /v1/ws?token=<jeton d'accès>`.
 *   client → serveur : `{ t: string, id?: string, ...données }`
 *   serveur → client : `{ t: string, re?: string, ...données }` (`re` = `id` du message auquel on répond)
 *   erreur           : `{ t: 'error', re?: string, code: ErrorCode, params: {} }`
 *
 * Chaque module décrit ses messages dans `src/ws/<module>.ts` avec `clientMessage` / `serverMessage`
 * et les enregistre côté serveur avec `app.registerWsHandler(type, schema, handler)`.
 */
import { z } from 'zod';

export const MESSAGE_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
export const MESSAGE_ID_MAX_LENGTH = 64;
/** Taille maximale d'un message reçu par le serveur. */
export const WS_MAX_PAYLOAD_BYTES = 64 * 1024;

export const ClientEnvelopeSchema = z.looseObject({
  t: z.string().min(1).max(64).regex(MESSAGE_TYPE_PATTERN),
  id: z.string().min(1).max(MESSAGE_ID_MAX_LENGTH).optional(),
});
export type ClientEnvelope = z.infer<typeof ClientEnvelopeSchema>;

export const ServerEnvelopeSchema = z.looseObject({
  t: z.string().min(1),
  re: z.string().optional(),
});
export type ServerEnvelope = z.infer<typeof ServerEnvelopeSchema>;

/** Schéma d'un message client → serveur de type `t`. */
export function clientMessage<T extends string, S extends z.ZodRawShape>(t: T, shape: S) {
  return z.object({ t: z.literal(t), id: z.string().min(1).max(MESSAGE_ID_MAX_LENGTH).optional(), ...shape });
}

/** Schéma d'un message serveur → client de type `t`. */
export function serverMessage<T extends string, S extends z.ZodRawShape>(t: T, shape: S) {
  return z.object({ t: z.literal(t), re: z.string().optional(), ...shape });
}

export const WsErrorMessageSchema = serverMessage('error', {
  code: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export type WsErrorMessage = z.infer<typeof WsErrorMessageSchema>;

/** Codes de fermeture de la connexion WebSocket envoyés par le serveur. */
export const WS_CLOSE_CODES = {
  /** Arrêt ou redémarrage du serveur : se reconnecter. */
  serverShutdown: 1001,
  /** Jeton absent ou invalide à l'ouverture. */
  unauthorized: 4401,
  /** Session fermée (déconnexion, mot de passe changé, compte supprimé) : ne pas se reconnecter avec ce jeton. */
  sessionRevoked: 4403,
  /** Trop de messages : se reconnecter plus tard. */
  tooManyMessages: 4429,
} as const;
