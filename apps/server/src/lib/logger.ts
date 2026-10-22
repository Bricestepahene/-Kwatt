/**
 * Journal du serveur (pino, fourni par Fastify).
 * On ne journalise jamais un mot de passe, un jeton ni un code (sauf l'e-mail de développement,
 * quand aucun serveur SMTP n'est configuré).
 */
import type { FastifyBaseLogger } from 'fastify';

export type Logger = FastifyBaseLogger;

/** Champs masqués dans le journal. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-admin-token"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.refreshToken',
  '*.accessToken',
  '*.resetToken',
];

/** Retire le jeton d'une URL avant de la journaliser (`/v1/ws?token=…`). */
export function scrubUrl(url: string): string {
  return url.replace(/([?&](?:token|access_token)=)[^&]*/gi, '$1[masqué]');
}
