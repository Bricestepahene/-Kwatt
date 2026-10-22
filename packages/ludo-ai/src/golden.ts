/**
 * Fixtures d'or : des parties complètes jouées par le moteur TypeScript
 * (lancers et coups au hasard, à graine), enregistrées pas à pas. Le
 * simulateur Python (research/ludo) les rejoue et doit retrouver exactement
 * les mêmes coups légaux et les mêmes positions : une divergence est une erreur.
 */
import { applyLegalMove, applyRoll, legalMoves, newGame, throwDistribution, type LudoState, type NewGameOptions } from '@kwatt/rules-ludo';
import { stateFeatures } from './learned.js';
import { createRng, hashNumbers, sample } from './rng.js';

/** Position condensée : ce que le simulateur Python compare. */
export interface CompactState {
  tokens: number[][];
  current: number;
  phase: LudoState['phase'];
  roll: number | null;
  sixesInRow: number;
  turnNo: number;
  ranking: number[];
  status: string[];
  /** Caractéristiques de l'évaluation apprise, par siège (learned.ts). */
  features: number[][];
}

/** [siège, pion, de, vers, [[siège, pion] pris…]] */
export type CompactMove = [number, number, number, number, [number, number][]];

export interface GoldenStep {
  /** Lancer appliqué, ou coup joué (index dans `legal` du pas précédent). */
  roll?: number;
  move?: number;
  /** Coups légaux après ce pas (phase « move »). */
  legal: CompactMove[];
  state: CompactState;
}

export interface GoldenGame {
  format: 'kwatt-ludo-golden';
  version: 1;
  options: { preset: string; players: number; teams: number[][] };
  steps: GoldenStep[];
}

function compact(state: LudoState): CompactState {
  return {
    tokens: state.tokens.map((t) => [...t]),
    current: state.current,
    phase: state.phase,
    roll: state.roll,
    sixesInRow: state.sixesInRow,
    turnNo: state.turnNo,
    ranking: [...state.ranking],
    status: state.seats.map((s) => s.status),
    features: state.seats.map((_, s) => stateFeatures(state, s).map((x) => Math.round(x * 1e9) / 1e9)),
  };
}

const compactMoves = (state: LudoState): CompactMove[] =>
  legalMoves(state).map((m) => [m.seat, m.token, m.from, m.to, m.captures.map((c): [number, number] => [c.seat, c.token])]);

/** Une partie au hasard (graine), enregistrée pas à pas. */
export function goldenGame(options: NewGameOptions, seed: number): GoldenGame {
  const rng = createRng(hashNumbers([seed, 0x901d]));
  let state = newGame(options);
  const dist = throwDistribution(state.config.mechanics.throw);
  const steps: GoldenStep[] = [];
  let guard = 0;
  while (state.phase !== 'over' && guard++ < 50_000) {
    if (state.phase === 'roll') {
      const roll = sample(dist, rng);
      state = applyRoll(state, roll);
      steps.push({ roll, legal: compactMoves(state), state: compact(state) });
    } else {
      const moves = legalMoves(state);
      const move = rng.int(moves.length);
      state = applyLegalMove(state, moves[move]!);
      steps.push({ move, legal: compactMoves(state), state: compact(state) });
    }
  }
  return {
    format: 'kwatt-ludo-golden',
    version: 1,
    options: { preset: options.preset, players: options.players, teams: options.teams ?? [] },
    steps,
  };
}

/** Le jeu de fixtures versionné dans research/ludo/fixtures (variantes du simulateur Python). */
export const GOLDEN_SET: { name: string; options: NewGameOptions; seeds: number[] }[] = [
  { name: 'classique-2', options: { preset: 'classique', players: 2 }, seeds: [1, 2, 3] },
  { name: 'classique-3', options: { preset: 'classique', players: 3 }, seeds: [4, 5] },
  { name: 'classique-4', options: { preset: 'classique', players: 4 }, seeds: [6, 7, 8] },
  { name: 'classique-4-equipes', options: { preset: 'classique', players: 4, teams: [[0, 2], [1, 3]] }, seeds: [9, 10] },
  { name: 'rapide-4', options: { preset: 'rapide', players: 4 }, seeds: [11, 12] },
  { name: 'six-6', options: { preset: 'six', players: 6 }, seeds: [13] },
];

/** Toutes les fixtures du jeu versionné, une partie par ligne (JSON Lines). */
export function goldenJsonl(): string {
  const lines: string[] = [];
  for (const set of GOLDEN_SET) for (const seed of set.seeds) lines.push(JSON.stringify(goldenGame(set.options, seed)));
  return lines.join('\n') + '\n';
}
