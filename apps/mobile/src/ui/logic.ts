/**
 * Logique pure des composants (codes, curseur, initiales), testée par vitest.
 */

/** Alphabet des codes de salon et de ligue : sans 0, O, 1 ni I (SPEC §10). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** Garde les caractères permis, en capitales, 6 au plus (« m4t-k9q » → « M4TK9Q »). */
export function normalizeRoomCode(input: string): string {
  let out = '';
  for (const ch of input.toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === ROOM_CODE_LENGTH) break;
  }
  return out;
}

/** Affichage « ABC-DEF » (le tiret apparaît dès le 4e caractère). */
export function formatRoomCode(code: string): string {
  const c = normalizeRoomCode(code);
  return c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

export function isRoomCodeComplete(code: string): boolean {
  return normalizeRoomCode(code).length === ROOM_CODE_LENGTH && normalizeRoomCode(code) === code;
}

/**
 * Code trouvé dans un texte collé : un code seul (« M4T-K9Q »), un lien
 * kwatt://salon/CODE, kwatt://ligue/CODE ou https://…/s/CODE. `null` sinon.
 */
export function extractRoomCode(text: string): string | null {
  const trimmed = text.trim();
  const link = /(?:kwatt:\/\/(?:salon|ligue)\/|\/s\/)([A-Za-z0-9-]{6,7})(?:[/?#].*)?$/i.exec(trimmed);
  const candidate = link?.[1] ?? (/^[A-Za-z0-9]{3}-?[A-Za-z0-9]{3}$/.test(trimmed) ? trimmed : null);
  if (!candidate) return null;
  const code = normalizeRoomCode(candidate);
  return code.length === ROOM_CODE_LENGTH && candidate.replace('-', '').length === ROOM_CODE_LENGTH ? code : null;
}

/** Code à 6 chiffres (e-mail) : chiffres seulement, 6 au plus. */
export function normalizeDigits(input: string, length = 6): string {
  return input.replace(/\D+/g, '').slice(0, length);
}

/** Valeur ramenée dans [min, max] et sur le pas du curseur. */
export function snap(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) return clamped;
  const snapped = Math.round((clamped - min) / step) * step + min;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

/** Initiale de l'avatar (« brice_237 » → « B », « émile » → « É », vide → « ? »). */
export function initialOf(name: string | null | undefined): string {
  const first = [...(name ?? '').trim()].find((ch) => /\p{L}|\p{N}/u.test(ch));
  return first ? first.toLocaleUpperCase('fr') : '?';
}

/** Échelons (SPEC §7), du plus bas au plus haut. */
export const RANKS = ['apprenti', 'debrouillard', 'ancien', 'notable', 'chef', 'fon'] as const;
export type RankId = (typeof RANKS)[number];

/**
 * Échelon d'un niveau (SPEC §7) : Apprenti 1–4, Débrouillard 5–9, Ancien du kwatt 10–14,
 * Notable 15–19, Chef 20–24, Fon 25 et plus. Le serveur fait foi : l'appli affiche
 * l'échelon reçu quand il est là (`@kwatt/domain` à l'intégration).
 */
export function rankForLevel(level: number): RankId {
  const l = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  if (l >= 25) return 'fon';
  if (l >= 20) return 'chef';
  if (l >= 15) return 'notable';
  if (l >= 10) return 'ancien';
  if (l >= 5) return 'debrouillard';
  return 'apprenti';
}
