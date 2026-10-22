/**
 * Problème du jour sur le plateau (écran 19b) — module pur.
 *
 * Le joueur joue ses coups sur le damier ; un coup juste est suivi de la réponse forcée de
 * l'adversaire (jouée par l'appli) ; à la fin de la suite, le problème est résolu et la
 * solution est envoyée au serveur, qui la revalide. Un coup faux arrête l'essai.
 */
import type { DailyPuzzle } from '@kwatt/protocol';
import { applyMove, boardFrom, fromPosition, moveKey, parseNotation, toNotation, type DamesState, type Move } from '@kwatt/rules-dames';

export interface PuzzleProgress {
  state: DamesState;
  /** Prochain coup attendu dans la solution. */
  step: number;
  status: 'playing' | 'solved' | 'wrong';
  /** Coups joués par le joueur (notation officielle). */
  played: string[];
  /** Toute la suite jouée (coups du joueur et réponses). */
  line: string[];
  last: Move | null;
  /** Coup faux : celui qui était attendu. */
  expected: string | null;
}

export function puzzleStart(p: DailyPuzzle): DamesState {
  const board = boardFrom(p.variant, { w: p.white.men, W: p.white.kings, b: p.black.men, B: p.black.kings });
  return fromPosition(p.variant, board, p.side);
}

export function startProgress(p: DailyPuzzle): PuzzleProgress {
  return { state: puzzleStart(p), step: 0, status: 'playing', played: [], line: [], last: null, expected: null };
}

/** C'est au joueur de jouer (et non à la réponse forcée). */
export function playerToMove(p: DailyPuzzle, g: PuzzleProgress): boolean {
  return g.status === 'playing' && g.step % 2 === 0 && g.step < p.solution.length;
}

export function playerMove(p: DailyPuzzle, g: PuzzleProgress, move: Move): PuzzleProgress {
  if (!playerToMove(p, g)) return g;
  const text = p.solution[g.step]!;
  const expected = parseNotation(g.state, text);
  const notation = toNotation(move);
  const state = applyMove(g.state, move);
  const played = [...g.played, notation];
  const line = [...g.line, notation];
  if (!expected || moveKey(expected) !== moveKey(move)) {
    return { ...g, state, played, line, last: move, status: 'wrong', expected: expected ? toNotation(expected) : text };
  }
  const step = g.step + 1;
  return { ...g, state, step, played, line, last: move, status: step >= p.solution.length ? 'solved' : 'playing' };
}

/** Joue la réponse forcée attendue (après un coup juste). */
export function forcedReply(p: DailyPuzzle, g: PuzzleProgress): PuzzleProgress {
  if (g.status !== 'playing' || g.step % 2 === 0 || g.step >= p.solution.length) return g;
  const move = parseNotation(g.state, p.solution[g.step]!);
  if (!move) return { ...g, status: 'wrong' };
  const step = g.step + 1;
  return {
    ...g,
    state: applyMove(g.state, move),
    step,
    line: [...g.line, toNotation(move)],
    last: move,
    status: step >= p.solution.length ? 'solved' : 'playing',
  };
}

/** Indice : la case du pion à jouer maintenant. */
export function hintSquare(p: DailyPuzzle, g: PuzzleProgress): number | null {
  if (!playerToMove(p, g)) return null;
  return parseNotation(g.state, p.solution[g.step]!)?.from ?? null;
}
