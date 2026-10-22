/**
 * Nom de partie d'un invité (écran 02, « Ton nom pour la partie ») : forme et mots interdits.
 * Les mots interdits sont ceux des pseudos (modules/auth/pseudo.ts), cherchés dans le nom
 * sans accents, avec les espaces et la ponctuation changés en « _ ».
 */
import { isValidDisplayNameFormat, normalizeDisplayName } from '@kwatt/protocol';
import { isBannedPseudo } from '../auth/pseudo.js';

export type DisplayNameProblem = 'invalid' | 'banned' | null;

/** Forme comparable aux pseudos : « Tonton Paul » → « tonton_paul ». */
export function displayNameAsPseudo(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function checkDisplayName(raw: string): { name: string; problem: DisplayNameProblem } {
  const name = normalizeDisplayName(raw);
  if (!isValidDisplayNameFormat(name)) return { name, problem: 'invalid' };
  if (isBannedPseudo(displayNameAsPseudo(name))) return { name, problem: 'banned' };
  return { name, problem: null };
}
