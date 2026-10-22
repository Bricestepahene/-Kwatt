/**
 * Écran 19 · Revoir une partie (module pur) : notation officielle par paire de coups
 * (« 22. 37-31 · 19-23 »), demi-coup ↔ numéro de coup, repères des moments clés.
 */

/** Ordre des camps : en 10×10 les blancs commencent, en 8×8 les noirs. */
export function firstSide(variant: string): 'w' | 'b' {
  return variant === 'dames8' ? 'b' : 'w';
}

/** Numéro du coup (1, 2, …) du demi-coup `ply` (0 = premier demi-coup). */
export function moveNumberOf(ply: number): number {
  return Math.floor(ply / 2) + 1;
}

/**
 * Ligne de notation du coup qui contient le demi-coup `ply` : « 22. 37-31 · 19-23 »
 * (la réponse manque si la partie s'arrête là).
 */
export function notationLine(moves: readonly string[], ply: number): string {
  if (moves.length === 0 || ply < 0) return '';
  const first = Math.floor(Math.min(ply, moves.length - 1) / 2) * 2;
  const a = moves[first];
  const b = moves[first + 1];
  return `${moveNumberOf(first)}. ${a ?? ''}${b ? ` · ${b}` : ''}`;
}

/** Position du curseur (0 à 1) d'un demi-coup sur la barre de la partie. */
export function progressOf(position: number, total: number): number {
  return total <= 0 ? 0 : Math.max(0, Math.min(1, position / total));
}

/** Coups « complets » d'une partie de dames. */
export function fullMoves(plies: number): number {
  return Math.ceil(plies / 2);
}
