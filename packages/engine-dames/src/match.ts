/**
 * Mini-match entre deux forces (contrôle de la planche Moteur : « chaque
 * version du moteur joue des parties contre la précédente »). Utilisé par le
 * test de contrôle et par le script `pnpm --filter @kwatt/engine-dames match`.
 */
import { applyMove, initialState, legalMoves, type DamesState, type Variant } from '@kwatt/rules-dames';
import { chooseMoveSync } from './play.js';
import { mulberry32 } from './random.js';

export interface MatchOptions {
  variant: Variant;
  /** Forces visées (null : pleine force). */
  ratingA: number | null;
  ratingB: number | null;
  games: number;
  /** Demi-coups au plus ; au-delà, arbitrage au matériel (dame = 2 pions). */
  maxPlies?: number;
  /** Demi-coups tirés au hasard au début de chaque partie (variété). */
  randomOpeningPlies?: number;
  seed?: number;
  maxNodes?: number;
}

export interface MatchGame {
  aIsWhite: boolean;
  plies: number;
  /** Points de A : 1, ½ ou 0. */
  scoreA: number;
  adjudicated: boolean;
}

export interface MatchResult {
  games: MatchGame[];
  scoreA: number;
  scoreB: number;
}

function materialBalance(state: DamesState): number {
  let n = 0;
  for (const p of state.board) n += p === 'w' ? 1 : p === 'W' ? 2 : p === 'b' ? -1 : p === 'B' ? -2 : 0;
  return n;
}

export function playMatch(options: MatchOptions): MatchResult {
  const maxPlies = options.maxPlies ?? 200;
  const games: MatchGame[] = [];
  for (let g = 0; g < options.games; g++) {
    const random = mulberry32((options.seed ?? 1) * 1000 + g);
    let state = initialState(options.variant);
    for (let i = 0; i < (options.randomOpeningPlies ?? 2) && !state.result; i++) {
      const moves = legalMoves(state);
      state = applyMove(state, moves[Math.floor(random() * moves.length)]!);
    }
    const aIsWhite = g % 2 === 0;
    let plies = 0;
    while (!state.result && plies < maxPlies) {
      const aToMove = (state.turn === 'w') === aIsWhite;
      const choice = chooseMoveSync(state, {
        targetRating: aToMove ? options.ratingA : options.ratingB,
        seed: g * 7919 + plies,
        ...(options.maxNodes !== undefined ? { maxNodes: options.maxNodes } : {}),
      });
      state = applyMove(state, choice.move);
      plies++;
    }
    let whiteScore: number;
    let adjudicated = false;
    if (state.result) {
      whiteScore = state.result.winner === null ? 0.5 : state.result.winner === 'w' ? 1 : 0;
    } else {
      adjudicated = true;
      const m = materialBalance(state);
      whiteScore = m > 0 ? 1 : m < 0 ? 0 : 0.5;
    }
    games.push({ aIsWhite, plies, scoreA: aIsWhite ? whiteScore : 1 - whiteScore, adjudicated });
  }
  const scoreA = games.reduce((s, x) => s + x.scoreA, 0);
  return { games, scoreA, scoreB: games.length - scoreA };
}
