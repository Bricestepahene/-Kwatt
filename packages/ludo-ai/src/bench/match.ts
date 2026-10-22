/**
 * Banc d'essai : des parties entre agents, avec
 * - nombres aléatoires communs : une « donne » = une suite de lancers fixée,
 *   rejouée pour chaque rotation des places (les agents comparés voient les
 *   mêmes lancers, ce qui réduit fortement la variance) ;
 * - places tournées : chaque agent joue à chaque place de la donne ;
 * - intervalle de confiance et test séquentiel (SPRT) pour s'arrêter tôt.
 *
 * Pur TypeScript (pas d'horloge imposée, pas d'I/O) : les lanceurs en ligne de
 * commande sont dans services/ludo-ai.
 */
import { applyLegalMove, applyRoll, newGame, teamOf, throwDistribution, type LudoState, type NewGameOptions } from '@kwatt/rules-ludo';
import { chooseMove } from '../choose.js';
import { createRng, hashNumbers, sample } from '../rng.js';
import type { Agent, Level } from '../types.js';
import { Sprt, wilson, meanInterval, type SprtOptions, type SprtVerdict } from './stats.js';

export interface Player {
  label: string;
  /** Niveau (agent du niveau) ou agent explicite. */
  level?: Level;
  agent?: Agent;
  budgetMs?: number;
  /** Plafond d'itérations (simulations, nœuds) : parties reproductibles. */
  maxIterations?: number;
}

export interface GameResult {
  /** Joueur (index dans la composition) assis à chaque siège. */
  seating: number[];
  /** Classement final des sièges. */
  ranking: number[];
  /** Place (1 = premier) de chaque joueur de la composition. */
  places: number[];
  /** Camp gagnant : sièges de l'équipe (ou du joueur) arrivée première. */
  winners: number[];
  steps: number;
  decisions: number;
}

const MAX_STEPS = 100_000;

/**
 * Joue une partie complète. `seating[siège]` = index du joueur dans `players`.
 * Les lancers viennent de `diceSeed` seulement (même graine = mêmes lancers,
 * dans l'ordre où ils sont demandés).
 */
export function playGame(options: NewGameOptions, players: Player[], seating: number[], diceSeed: number, agentSeed: number, now?: () => number): GameResult {
  let state: LudoState = newGame(options);
  const dice = createRng(diceSeed);
  const dist = throwDistribution(state.config.mechanics.throw);
  let steps = 0;
  let decisions = 0;
  while (state.phase !== 'over') {
    if (++steps > MAX_STEPS) throw new Error('Partie trop longue');
    if (state.phase === 'roll') {
      state = applyRoll(state, sample(dist, dice));
      continue;
    }
    const player = players[seating[state.current]!]!;
    const result = chooseMove({
      state,
      level: player.level ?? 'coriace',
      seed: hashNumbers([agentSeed, decisions]),
      ...(player.agent ? { agent: player.agent } : {}),
      ...(player.budgetMs !== undefined ? { budgetMs: player.budgetMs } : {}),
      ...(player.maxIterations !== undefined ? { maxIterations: player.maxIterations } : {}),
      ...(now ? { now } : {}),
    });
    decisions++;
    state = applyLegalMove(state, result.move);
  }
  const placeOfSeat = new Map(state.ranking.map((seat, i) => [seat, i + 1]));
  const places = players.map(() => 0);
  seating.forEach((p, seat) => {
    places[p] = placeOfSeat.get(seat)!;
  });
  const first = state.ranking[0]!;
  const winners = state.seats.map((_, s) => s).filter((s) => teamOf(state, s) === teamOf(state, first));
  return { seating, ranking: state.ranking, places, winners, steps, decisions };
}

export interface MatchOptions {
  game: NewGameOptions;
  /** Composition : un joueur par siège ; les places tournent à chaque donne. */
  lineup: Player[];
  /** Nombre de donnes (chacune jouée dans toutes les rotations des places). */
  deals: number;
  seed: number;
  /** Arrêt anticipé sur les victoires du joueur 0 (test séquentiel). */
  sprt?: SprtOptions;
  onGame?: (game: GameResult, index: number) => void;
  now?: () => number;
  /** Ne joue que les donnes d'index ≡ shard (mod shards) : pour répartir sur plusieurs processus. */
  shard?: { index: number; count: number };
}

export interface PlayerSummary {
  label: string;
  games: number;
  wins: number;
  winRate: { p: number; low: number; high: number };
  /** Score moyen : 1 au premier, 0 au dernier, linéaire entre les deux. */
  score: { mean: number; low: number; high: number };
  meanPlace: number;
}

export interface MatchResult {
  games: number;
  players: PlayerSummary[];
  sprt?: { verdict: SprtVerdict; llr: number; games: number };
  results: GameResult[];
}

export function runMatch(options: MatchOptions): MatchResult {
  const n = options.game.players;
  const k = options.lineup.length;
  if (k !== n) throw new Error('Un joueur par siège');
  const results: GameResult[] = [];
  const sprt = options.sprt ? new Sprt(options.sprt) : null;
  let verdict: SprtVerdict = 'continue';
  outer: for (let d = 0; d < options.deals; d++) {
    if (options.shard && d % options.shard.count !== options.shard.index) continue;
    const diceSeed = hashNumbers([options.seed, d, 0x0d1ce]);
    for (let r = 0; r < n; r++) {
      const seating = Array.from({ length: n }, (_, seat) => (seat + r) % n);
      const g = playGame(options.game, options.lineup, seating, diceSeed, hashNumbers([options.seed, d, r]), options.now);
      results.push(g);
      options.onGame?.(g, results.length - 1);
      if (sprt) {
        const seat0 = seating.indexOf(0);
        verdict = sprt.add(g.winners.includes(seat0) ? 1 : 0);
        if (verdict !== 'continue') break outer;
      }
    }
  }
  return summarize(options.lineup, results, sprt ? { verdict, llr: sprt.llr, games: sprt.n } : undefined);
}

export function summarize(lineup: Player[], results: GameResult[], sprt?: MatchResult['sprt']): MatchResult {
  const n = lineup.length;
  const players = lineup.map((p, i): PlayerSummary => {
    const wins = results.filter((g) => g.winners.includes(g.seating.indexOf(i))).length;
    const scores = results.map((g) => (n - g.places[i]!) / Math.max(1, n - 1));
    const s = meanInterval(scores);
    return {
      label: p.label,
      games: results.length,
      wins,
      winRate: wilson(wins, results.length),
      score: { mean: s.mean, low: s.low, high: s.high },
      meanPlace: results.reduce((a, g) => a + g.places[i]!, 0) / Math.max(1, results.length),
    };
  });
  return { games: results.length, players, ...(sprt ? { sprt } : {}), results };
}
