/**
 * Agent heuristique explicable : chaque coup reçoit un score, somme de
 * raisons pondérées (progression, sortie, capture, mise à l'abri, danger,
 * couloir final, barrières, jeu d'équipe, bonus). Le danger utilise la
 * probabilité exacte d'être pris avant ton prochain tour (`threats.ts`), ou
 * une estimation rapide pour les niveaux bas.
 */
import {
  absoluteSquare,
  applyLegalMove,
  arePartners,
  BASE,
  finish,
  isSafeSquare,
  lastTrack,
  type LudoMove,
  type LudoState,
} from '@kwatt/rules-ludo';
import { DEFAULT_WEIGHTS, fastRisk, reachMap, tokenValue } from '../position.js';
import { threatsTo } from '../threats.js';
import type { Agent, AgentContext, Candidate, Decision, Reason, ReasonCode } from '../types.js';

export interface HeuristicWeights {
  progress: number;
  exit: number;
  capture: number;
  home: number;
  corridor: number;
  safe: number;
  /** Multiplie la variation de la perte attendue du camp (après − avant) : un coup qui expose coûte. */
  danger: number;
  barrier: number;
  team: number;
  bonus: number;
  extraRoll: number;
  /** Poids des pions du partenaire dans la perte attendue. */
  partner: number;
}

export const HEURISTIC_WEIGHTS: HeuristicWeights = {
  progress: 1,
  exit: 0.35,
  capture: 1.2,
  home: 0.3,
  corridor: 0.25,
  safe: 0.1,
  danger: 1,
  barrier: 0.12,
  team: 0.1,
  bonus: 1,
  extraRoll: 0.08,
  partner: 0.8,
};

export interface HeuristicOptions {
  weights?: Partial<HeuristicWeights>;
  /** Menaces : calcul exact ou estimation rapide. */
  threats?: 'exact' | 'fast' | 'none';
  /** Hésitation : 0 = toujours le meilleur score ; plus haut = choix plus souvent imparfaits (loi softmax). */
  temperature?: number;
}

interface Risk {
  perToken: number[][];
  any: number;
}

function riskOf(state: LudoState, seat: number, mode: 'exact' | 'fast' | 'none'): Risk {
  if (mode === 'exact') return threatsTo(state, seat);
  const perToken = state.tokens.map((list) => list.map(() => 0));
  if (mode === 'none') return { perToken, any: 0 };
  const reach = reachMap(state);
  let safe = 1;
  state.tokens.forEach((list, s) => {
    if (!arePartners(state, seat, s)) return;
    list.forEach((p, t) => {
      const r = fastRisk(state, reach, s, p);
      perToken[s]![t] = r;
      safe *= 1 - r;
    });
  });
  return { perToken, any: 1 - safe };
}

/** Perte attendue du camp de `seat` : Σ probabilité d'être pris × valeur du pion. */
function expectedLoss(state: LudoState, seat: number, risk: Risk, partnerWeight: number): number {
  let loss = 0;
  state.tokens.forEach((list, s) => {
    if (!arePartners(state, seat, s)) return;
    const w = s === seat ? 1 : partnerWeight;
    list.forEach((p, t) => {
      loss += w * risk.perToken[s]![t]! * tokenValue(state, p, DEFAULT_WEIGHTS);
    });
  });
  return loss;
}

/** Pions adverses (ou partenaires) arrêtés derrière une case, à moins de `reach` cases. */
function tokensBehind(state: LudoState, square: number, reach: number, filter: (seat: number) => boolean): number {
  let count = 0;
  state.tokens.forEach((list, s) => {
    if (!filter(s) || state.seats[s]!.status === 'out') return;
    const home = state.seats[s]!.home;
    for (const p of list) {
      for (let d = 1; d <= reach; d++) {
        if (absoluteSquare(state.config, home, p + d) === square && absoluteSquare(state.config, home, p) !== null) {
          count++;
          break;
        }
      }
    }
  });
  return count;
}

/** Une barrière du camp sur cette case (deux pions du même siège, barrières permises). */
function ownBarrierAt(state: LudoState, seat: number, square: number): boolean {
  if (state.config.mechanics.barriers === 'none') return false;
  const home = state.seats[seat]!.home;
  return state.tokens[seat]!.filter((p) => absoluteSquare(state.config, home, p) === square).length >= 2;
}

export interface MoveFeatures {
  reasons: Reason[];
  score: number;
  pCapture: number;
  pSafe: number;
}

/** Score d'un coup et ses raisons. `riskBefore` : menaces avant le coup (calculées une fois). */
export function scoreMove(state: LudoState, move: LudoMove, seat: number, opts: Required<HeuristicOptions> & { weights: HeuristicWeights }, riskBefore: Risk): MoveFeatures {
  const w = opts.weights;
  const config = state.config;
  const end = finish(config);
  const after = applyLegalMove(state, move);
  const reasons: Reason[] = [];
  const add = (code: ReasonCode, value: number): void => {
    if (Math.abs(value) > 1e-9) reasons.push({ code, value });
  };
  const from = move.from;
  const to = move.to;
  const lt = lastTrack(config);

  add('progress', (w.progress * (to - (from === BASE ? -1 : from))) / (end + 1));
  if (from === BASE) add('exit', w.exit);
  if (to === end) add('home', w.home);
  // Entrée dans le couloir final : le pion ne peut plus être pris.
  else if (to > lt && from <= lt) add('corridor', w.corridor);
  const victims = move.captures.reduce((sum, c) => sum + tokenValue(state, state.tokens[c.seat]![c.token]!, DEFAULT_WEIGHTS), 0);
  add('capture', w.capture * victims);
  const landing = absoluteSquare(config, state.seats[move.seat]!.home, to);
  if (landing !== null && isSafeSquare(config, landing)) add('safe', w.safe);

  // Danger : variation de la perte attendue de tout le camp (le pion joué et ceux qu'il protégeait).
  const riskAfter = riskOf(after, seat, opts.threats);
  const lossBefore = expectedLoss(state, seat, riskBefore, w.partner);
  const lossAfter = expectedLoss(after, seat, riskAfter, w.partner);
  add('danger', -w.danger * (lossAfter - lossBefore));

  // Barrières : en former une devant des adversaires, en ouvrir une qui bloquait un partenaire.
  if (config.mechanics.barriers !== 'none') {
    const enemy = (s: number): boolean => !arePartners(state, seat, s);
    const friend = (s: number): boolean => s !== move.seat && arePartners(state, seat, s);
    if (landing !== null && ownBarrierAt(after, move.seat, landing)) {
      add('barrier', (w.barrier * Math.min(3, tokensBehind(after, landing, 12, enemy))) / 3);
      add('team', (-w.team * Math.min(2, tokensBehind(after, landing, 6, friend))) / 2);
    }
    const fromSq = from === BASE ? null : absoluteSquare(config, state.seats[move.seat]!.home, from);
    if (fromSq !== null && ownBarrierAt(state, move.seat, fromSq)) {
      add('barrier', (-w.barrier * Math.min(3, tokensBehind(state, fromSq, 12, enemy))) / 3);
      add('team', (w.team * Math.min(2, tokensBehind(state, fromSq, 6, friend))) / 2);
    }
  }
  const m = config.mechanics;
  const bonus = (move.captures.length > 0 ? m.captureBonus : 0) + (to === end ? m.homeBonus : 0);
  if (bonus > 0) add('bonus', (w.bonus * bonus) / (end + 1));
  if (m.captureGivesRoll && move.captures.length > 0) add('extra_roll', w.extraRoll);

  const score = reasons.reduce((s, r) => s + r.value, 0);
  const pCapture = riskAfter.perToken[move.seat]?.[move.token] ?? 0;
  return { reasons, score, pCapture, pSafe: 1 - riskAfter.any };
}

/** Choix softmax (température > 0) ou meilleur score (température 0, premier en cas d'égalité). */
export function pickByScore(scores: number[], temperature: number, rng: AgentContext['rng']): number {
  if (temperature <= 0) {
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]! + 1e-12) best = i;
    return best;
  }
  const max = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - max) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let u = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    u -= weights[i]!;
    if (u <= 0) return i;
  }
  return weights.length - 1;
}

export function resolveHeuristic(options: HeuristicOptions = {}): Required<HeuristicOptions> & { weights: HeuristicWeights } {
  return {
    weights: { ...HEURISTIC_WEIGHTS, ...options.weights },
    threats: options.threats ?? 'exact',
    temperature: options.temperature ?? 0,
  };
}

/** Scores de tous les coups (utilisé aussi pour expliquer les choix des autres agents). */
export function scoreAll(state: LudoState, moves: LudoMove[], seat: number, options: HeuristicOptions = {}): Candidate[] {
  const opts = resolveHeuristic(options);
  const before = riskOf(state, seat, opts.threats);
  return moves.map((move) => {
    const f = scoreMove(state, move, seat, opts, before);
    const c: Candidate = { move, score: f.score, reasons: f.reasons };
    if (opts.threats !== 'none') {
      c.pCapture = f.pCapture;
      c.pSafe = f.pSafe;
    }
    return c;
  });
}

export function heuristicAgent(options: HeuristicOptions = {}, id = 'heuristic@1'): Agent {
  const opts = resolveHeuristic(options);
  return {
    id,
    choose(state: LudoState, moves: LudoMove[], ctx: AgentContext): Decision {
      const candidates = scoreAll(state, moves, ctx.seat, opts);
      const i = pickByScore(
        candidates.map((c) => c.score),
        opts.temperature,
        ctx.rng,
      );
      return { move: candidates[i]!.move, candidates, stats: { nodes: moves.length } };
    },
  };
}
