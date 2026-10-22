/**
 * Toucher le pion, puis la case (SPEC §5) — module pur.
 *
 * - Un toucher sur un pion qui peut jouer le sélectionne ; les cases d'arrivée possibles
 *   deviennent les cibles.
 * - Un toucher sur une cible joue le coup. Si deux rafles différentes mènent à la même
 *   case (mêmes nombres de pièces prises, pièces différentes), on demande la case de
 *   passage : les cibles deviennent les cases qui séparent ces rafles, jusqu'à ce qu'il
 *   n'en reste qu'une.
 * - Un toucher ailleurs annule (ou sélectionne un autre pion).
 */
import type { Move } from '@kwatt/rules-dames';

export interface Selection {
  /** Case du pion choisi, ou null. */
  from: number | null;
  /** Cases de passage déjà choisies pour lever une ambiguïté. */
  via: number[];
}

export const EMPTY_SELECTION: Selection = { from: null, via: [] };

export type TapResult =
  | { kind: 'select'; selection: Selection }
  | { kind: 'play'; move: Move; selection: Selection }
  | { kind: 'invalid'; selection: Selection };

/** Pièces qui peuvent jouer (départs des coups légaux). */
export function movablePieces(legal: readonly Move[]): number[] {
  return [...new Set(legal.map((m) => m.from))];
}

/** Coups encore possibles pour la sélection en cours. */
export function candidates(legal: readonly Move[], sel: Selection): Move[] {
  if (sel.from === null) return [];
  return legal.filter((m) => m.from === sel.from && sel.via.every((v) => m.path.includes(v)));
}

/** Cases à proposer : arrivées, ou cases de passage qui départagent des rafles de même arrivée. */
export function targetsOf(legal: readonly Move[], sel: Selection): number[] {
  const moves = candidates(legal, sel);
  if (sel.via.length === 0) return [...new Set(moves.map((m) => m.to))];
  return disambiguators(moves);
}

/** Cases de passage présentes dans certaines rafles mais pas toutes. */
function disambiguators(moves: readonly Move[]): number[] {
  const counts = new Map<number, number>();
  for (const m of moves) for (const sq of new Set(m.path.slice(1, -1))) counts.set(sq, (counts.get(sq) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n < moves.length).map(([sq]) => sq);
}

export function tap(legal: readonly Move[], sel: Selection, square: number): TapResult {
  const movable = movablePieces(legal);
  if (sel.from === null) {
    if (movable.includes(square)) return { kind: 'select', selection: { from: square, via: [] } };
    return { kind: 'invalid', selection: EMPTY_SELECTION };
  }
  const moves = candidates(legal, sel);
  if (sel.via.length === 0) {
    // Une rafle peut revenir sur sa case de départ : on la joue plutôt que de désélectionner.
    const arriving = moves.filter((m) => m.to === square);
    if (arriving.length === 0 && square === sel.from) return { kind: 'select', selection: EMPTY_SELECTION };
    if (arriving.length === 1) return { kind: 'play', move: arriving[0]!, selection: EMPTY_SELECTION };
    if (arriving.length > 1) {
      // Même arrivée, rafles différentes : on demande par où passer. L'arrivée est retenue.
      return { kind: 'select', selection: { from: sel.from, via: [square] } };
    }
  } else {
    const split = disambiguators(moves);
    if (split.includes(square)) {
      const next: Selection = { from: sel.from, via: [...sel.via, square] };
      const left = candidates(legal, next);
      if (left.length === 1) return { kind: 'play', move: left[0]!, selection: EMPTY_SELECTION };
      return { kind: 'select', selection: next };
    }
  }
  if (movable.includes(square)) return { kind: 'select', selection: { from: square, via: [] } };
  return { kind: 'invalid', selection: sel };
}

/** Pièces adverses que la sélection prendrait (contour pointillé corail). */
export function threatened(legal: readonly Move[], sel: Selection): number[] {
  return [...new Set(candidates(legal, sel).flatMap((m) => m.captures))];
}

/** La prise est obligatoire à ce coup. */
export function captureRequired(legal: readonly Move[]): boolean {
  return legal.length > 0 && legal[0]!.captures.length > 0;
}
