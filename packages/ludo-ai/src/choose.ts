/**
 * Point d'entrée : la machine choisit un coup.
 *
 * Elle reçoit la position (avec le lancer déjà fait par le serveur) et,
 * éventuellement, la liste des coups légaux ; elle ne touche jamais au dé.
 * Les coups proposés sont recoupés avec ceux des règles : la machine ne joue
 * jamais un coup illégal, même si on lui en propose un.
 */
import { distinctMoves, legalMoves, type LudoMove, type LudoState } from '@kwatt/rules-ludo';
import { LEVEL_SPECS } from './levels.js';
import { createRng, hashNumbers } from './rng.js';
import type { Agent, Candidate, Level, SearchStats } from './types.js';

/** Plafond de réflexion, quel que soit le budget demandé. */
export const MAX_BUDGET_MS = 5000;

export interface ChooseInput {
  state: LudoState;
  /** Coups légaux (facultatif) : recoupés avec ceux des règles. */
  legal?: LudoMove[];
  level: Level;
  /** Graine des simulations ; par défaut, tirée de la position (même position, même choix). */
  seed?: number;
  /** Budget de réflexion (ms), plafonné à MAX_BUDGET_MS ; par défaut celui du niveau. */
  budgetMs?: number;
  /** Plafond d'itérations : recherche reproductible, sans dépendre de l'horloge. */
  maxIterations?: number;
  /** Horloge (ms) ; par défaut performance.now() ou Date.now(). */
  now?: () => number;
  /** Agent à utiliser à la place de celui du niveau (banc d'essai). */
  agent?: Agent;
}

export interface ChooseResult {
  move: LudoMove;
  candidates: Candidate[];
  stats: SearchStats;
  /** Agent qui a choisi (avec sa version). */
  agent: string;
  level: Level;
}

export class NoMoveError extends Error {
  constructor() {
    super('ludo_ai.no_move');
    this.name = 'NoMoveError';
  }
}

/** Horloge par défaut : performance.now() (appli, Node) sinon Date.now(). */
export function defaultNow(): () => number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? () => perf.now() : () => Date.now();
}

/** Graine tirée de la position : même position, même lancer, même choix. */
export function positionSeed(state: LudoState): number {
  return hashNumbers([state.turnNo, state.current, state.roll ?? 0, state.bonus[0] ?? 0, ...state.tokens.flat()]);
}

const sameMove = (a: LudoMove, b: LudoMove): boolean => a.seat === b.seat && a.token === b.token && a.from === b.from && a.to === b.to;

export function chooseMove(input: ChooseInput): ChooseResult {
  const now = input.now ?? defaultNow();
  const t0 = now();
  const { state, level } = input;
  const spec = LEVEL_SPECS[level];
  const agent = input.agent ?? spec.agent;
  const rules = legalMoves(state);
  // Les coups proposés ne valent que s'ils sont légaux.
  const offered = input.legal ? rules.filter((m) => input.legal!.some((x) => sameMove(x, m))) : rules;
  const legal = offered.length > 0 ? offered : rules;
  if (legal.length === 0) throw new NoMoveError();
  const moves = distinctMoves(legal);
  if (moves.length === 1) {
    return { move: moves[0]!, candidates: [{ move: moves[0]!, score: 1 }], stats: { elapsedMs: now() - t0 }, agent: agent.id, level };
  }
  const budget = Math.max(0, Math.min(MAX_BUDGET_MS, input.budgetMs ?? spec.budgetMs));
  const ctx = {
    seat: state.current,
    rng: createRng(input.seed ?? positionSeed(state)),
    now,
    deadline: t0 + budget,
    ...(input.maxIterations !== undefined ? { maxIterations: input.maxIterations } : {}),
  };
  const d = agent.choose(state, moves, ctx);
  const move = legal.find((m) => sameMove(m, d.move)) ?? moves[0]!;
  return { move, candidates: d.candidates, stats: { ...d.stats, elapsedMs: now() - t0 }, agent: agent.id, level };
}
