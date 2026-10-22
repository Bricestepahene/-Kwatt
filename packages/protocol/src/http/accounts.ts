/**
 * Compléments des comptes (équipe Comptes) : nom de partie d'un invité.
 *
 * Routes (module serveur « accounts ») :
 *   GET /v1/me/display-name   (session) → DisplayNameResponse
 *   PUT /v1/me/display-name   (session) DisplayNameRequest → DisplayNameResponse
 *
 * Un invité n'a pas de pseudo : il donne un nom pour la partie (écran 02, « Tonton Paul »),
 * affiché dans les salons. 2 à 20 caractères : lettres (accents compris), chiffres, espaces,
 * « . », « _ », « - », « ' ». Ni unique ni traduit. Les salons lisent
 * COALESCE(pseudo du profil, nom de partie).
 */
import { z } from 'zod';

export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 20;
/** Forme d'un nom de partie, une fois les espaces superflus retirés. */
export const DISPLAY_NAME_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ._'’-]{0,18}[\p{L}\p{M}\p{N}.]$/u;

/** Espaces en trop retirés (début, fin, doubles) : forme gardée par le serveur. */
export function normalizeDisplayName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function isValidDisplayNameFormat(name: string): boolean {
  const n = normalizeDisplayName(name);
  return [...n].length >= DISPLAY_NAME_MIN_LENGTH && [...n].length <= DISPLAY_NAME_MAX_LENGTH && DISPLAY_NAME_PATTERN.test(n);
}

export const DisplayNameRequestSchema = z.object({ displayName: z.string().max(64) });
export type DisplayNameRequest = z.infer<typeof DisplayNameRequestSchema>;

export const DisplayNameResponseSchema = z.object({ displayName: z.string().nullable() });
export type DisplayNameResponse = z.infer<typeof DisplayNameResponseSchema>;
