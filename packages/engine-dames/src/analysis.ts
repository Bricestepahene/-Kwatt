/**
 * Analyse d'une partie pour « Revoir » (écran 19), indice et taux d'accord
 * avec le moteur (anti-triche, planche Moteur).
 *
 * Méthode : une recherche par position (même budget pour toutes). Le score
 * du coup joué se lit dans la position suivante (score adverse, de signe
 * opposé) ; la perte d'un coup = meilleur score − score obtenu.
 * Qualité : meilleur (perte ≤ 10 ou coup du moteur), bon (≤ 40),
 * imprécision (≤ 90), erreur (au-delà : un pion ou plus).
 *
 * Aucun texte : des codes (`best`, `piece_left_hanging`…) et des paramètres,
 * traduits par l'appli.
 */
import { applyMove, initialState, parseNotation, type DamesState, type Move, type Side, type Variant } from '@kwatt/rules-dames';
import { Position, emoveKey, emoveNotation } from './core.js';
import { defaultWeights } from './evaluate.js';
import { MATE_BOUND, Search, runAsync, runSync, type AsyncDriveOptions } from './search.js';

export type MoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake';

/** Seuils de perte (centièmes de pion) : meilleur ≤ 10, bon ≤ 40, imprécision ≤ 90, erreur au-delà. */
export const QUALITY_THRESHOLDS = { best: 10, good: 40, inaccuracy: 90 } as const;

/** Les scores de gain forcé sont ramenés à ±2 000 pour mesurer les pertes. */
const SCORE_CLAMP = 2000;

export interface AnalysisBudget {
  /** Nœuds par position (25 000 par défaut). */
  maxNodesPerMove?: number;
  /** Profondeur maximale par position (10 par défaut). */
  depth?: number;
  now?: () => number;
}

export interface AnalyzedMove {
  /** Demi-coup (0 = premier coup de la partie). */
  ply: number;
  /** Numéro du coup en notation officielle (« Coup 22 »). */
  moveNumber: number;
  side: Side;
  notation: string;
  bestNotation: string;
  quality: MoveQuality;
  /** Perte par rapport au meilleur coup (≥ 0). */
  loss: number;
  /** Évaluation avant et après le coup, du point de vue des blancs. */
  evalBefore: number;
  evalAfter: number;
  /** Un seul coup légal. */
  forced: boolean;
  captures: number;
  promotes: boolean;
}

export type KeyMomentKind = 'piece_left_hanging' | 'mistake' | 'rafle' | 'promotion' | 'missed_win' | 'turning_point';

export interface KeyMoment {
  ply: number;
  moveNumber: number;
  side: Side;
  kind: KeyMomentKind;
  /** Paramètres de traduction : `square` (pion en prise), `count` (rafle), `loss`. */
  params: Record<string, number>;
}

export interface GameAnalysis {
  variant: Variant;
  moves: AnalyzedMove[];
  keyMoments: KeyMoment[];
  /** Perte moyenne par camp (coups forcés exclus). */
  averageLoss: Record<Side, number>;
  /** Nombre de coups de chaque qualité, par camp. */
  counts: Record<Side, Record<MoveQuality, number>>;
}

export type MoveInput = string | (Pick<Move, 'from' | 'to'> & { captures?: number[] });

/** Rejoue une liste de coups (notation officielle ou objets) depuis le début ou un état donné. */
export function replay(variant: Variant, moves: readonly MoveInput[], start?: DamesState): DamesState[] {
  const states: DamesState[] = [start ?? initialState(variant)];
  for (const m of moves) {
    const s = states[states.length - 1]!;
    const candidate = typeof m === 'string' ? parseNotation(s, m) : m;
    if (!candidate) throw new Error(`Coup illisible : ${String(m)}`);
    states.push(applyMove(s, candidate));
  }
  return states;
}

const clamp = (s: number): number => Math.max(-SCORE_CLAMP, Math.min(SCORE_CLAMP, s));

export function qualityOf(loss: number, isEngineBest: boolean): MoveQuality {
  if (isEngineBest || loss <= QUALITY_THRESHOLDS.best) return 'best';
  if (loss <= QUALITY_THRESHOLDS.good) return 'good';
  if (loss <= QUALITY_THRESHOLDS.inaccuracy) return 'inaccuracy';
  return 'mistake';
}

interface PositionEval {
  /** Score pour le camp au trait. */
  score: number;
  bestKey: string | null;
  bestNotation: string;
  legalCount: number;
}

function* evalPosition(state: DamesState, budget: AnalysisBudget): Generator<void, PositionEval, void> {
  if (state.result) {
    const score = state.result.winner === null ? 0 : state.result.winner === state.turn ? SCORE_CLAMP : -SCORE_CLAMP;
    return { score, bestKey: null, bestNotation: '', legalCount: 0 };
  }
  const pos = Position.fromState(state);
  const legalCount = pos.legalMoves().length;
  const search = new Search(pos, {
    weights: defaultWeights(pos.g.size),
    maxDepth: budget.depth ?? 10,
    maxNodes: budget.maxNodesPerMove ?? 25_000,
    ...(budget.now ? { now: budget.now } : {}),
  });
  const r = yield* search.run();
  return {
    score: clamp(r.score),
    bestKey: r.best ? emoveKey(r.best) : null,
    bestNotation: r.best ? emoveNotation(r.best) : '',
    legalCount,
  };
}

export function* analyzeGameGen(
  variant: Variant,
  moves: readonly MoveInput[],
  options: AnalysisBudget & { start?: DamesState } = {},
): Generator<void, GameAnalysis, void> {
  const states = replay(variant, moves, options.start);
  const evals: PositionEval[] = [];
  for (const s of states) evals.push(yield* evalPosition(s, options));
  const analyzed: AnalyzedMove[] = [];
  const keyMoments: KeyMoment[] = [];
  const firstPly = states[0]!.ply;
  for (let i = 0; i < states.length - 1; i++) {
    const before = states[i]!;
    const after = states[i + 1]!;
    const side = before.turn;
    const sign = side === 'w' ? 1 : -1;
    const eb = evals[i]!;
    const ea = evals[i + 1]!;
    // Score du coup joué, pour le camp qui joue = − score de l'adversaire ensuite.
    const got = -ea.score;
    const played = movePlayed(before, after);
    const isBest = eb.bestKey !== null && emoveKey(played) === eb.bestKey;
    const loss = Math.max(0, eb.score - got);
    const forced = eb.legalCount === 1;
    const quality = forced ? 'best' : qualityOf(loss, isBest);
    const ply = firstPly + i;
    const moveNumber = Math.floor(ply / 2) + 1;
    const captures = played.captures.length;
    const promotes = countKings(after, side) > countKings(before, side);
    analyzed.push({
      ply,
      moveNumber,
      side,
      notation: played.captures.length ? played.path.join('x') : `${played.from}-${played.to}`,
      bestNotation: eb.bestNotation,
      quality,
      loss: forced ? 0 : loss,
      evalBefore: sign * eb.score,
      evalAfter: sign * got,
      forced,
      captures,
      promotes,
    });
    // Moments clés.
    if (quality === 'mistake') {
      const hanging = hangingSquare(after, side);
      if (eb.score >= 300 && got <= 50) {
        keyMoments.push({ ply, moveNumber, side, kind: 'missed_win', params: { loss } });
      } else if (hanging !== null) {
        keyMoments.push({ ply, moveNumber, side, kind: 'piece_left_hanging', params: { square: hanging, loss } });
      } else {
        keyMoments.push({ ply, moveNumber, side, kind: 'mistake', params: { loss } });
      }
    }
    if (captures >= 3) keyMoments.push({ ply, moveNumber, side, kind: 'rafle', params: { count: captures } });
    if (promotes) keyMoments.push({ ply, moveNumber, side, kind: 'promotion', params: { square: played.to } });
  }
  // Tournant de la partie : le plus grand écart d'évaluation, s'il n'est pas déjà signalé.
  let swing = { i: -1, size: 0 };
  analyzed.forEach((m, i) => {
    const size = Math.abs(m.evalAfter - m.evalBefore);
    if (size > swing.size) swing = { i, size };
  });
  if (swing.i >= 0 && swing.size >= 150) {
    const m = analyzed[swing.i]!;
    if (!keyMoments.some((k) => k.ply === m.ply)) {
      keyMoments.push({ ply: m.ply, moveNumber: m.moveNumber, side: m.side, kind: 'turning_point', params: { swing: swing.size } });
    }
  }
  keyMoments.sort((a, b) => a.ply - b.ply);
  const sum = { w: 0, b: 0 };
  const n = { w: 0, b: 0 };
  const counts: Record<Side, Record<MoveQuality, number>> = {
    w: { best: 0, good: 0, inaccuracy: 0, mistake: 0 },
    b: { best: 0, good: 0, inaccuracy: 0, mistake: 0 },
  };
  for (const m of analyzed) {
    counts[m.side][m.quality]++;
    if (m.forced) continue;
    sum[m.side] += m.loss;
    n[m.side]++;
  }
  return {
    variant,
    moves: analyzed,
    keyMoments,
    averageLoss: { w: n.w ? Math.round(sum.w / n.w) : 0, b: n.b ? Math.round(sum.b / n.b) : 0 },
    counts,
  };
}

/** Le coup qui mène de `before` à `after` (retrouvé parmi les coups légaux). */
function movePlayed(before: DamesState, after: DamesState): Move {
  const pos = Position.fromState(before);
  for (const m of pos.legalMoves()) {
    pos.make(m);
    const same = pos.toBoard().every((p, i) => p === after.board[i]);
    pos.unmake();
    if (same) return { from: m.from, to: m.to, path: m.path, captures: m.caps };
  }
  throw new Error('Coup introuvable');
}

function countKings(state: DamesState, side: Side): number {
  const k = side === 'w' ? 'W' : 'B';
  return state.board.filter((p) => p === k).length;
}

/**
 * Pion laissé en prise : après le coup, l'adversaire a une prise et la
 * meilleure prend une pièce du camp qui vient de jouer. Renvoie la case de la
 * première pièce prise (« ton pion de la case 32 est en prise »).
 */
function hangingSquare(after: DamesState, mover: Side): number | null {
  if (after.result) return null;
  const pos = Position.fromState(after);
  const caps: ReturnType<Position['legalMoves']> = [];
  pos.genCaptures(caps);
  if (caps.length === 0) return null;
  const moverCode = mover === 'w' ? 1 : -1;
  const victim = caps[0]!.caps.find((s) => pos.b[s]! * moverCode > 0);
  return victim ?? null;
}

export function analyzeGame(
  variant: Variant,
  moves: readonly MoveInput[],
  options: AnalysisBudget & AsyncDriveOptions & { start?: DamesState } = {},
): Promise<GameAnalysis> {
  return runAsync(analyzeGameGen(variant, moves, options), options);
}

export function analyzeGameSync(variant: Variant, moves: readonly MoveInput[], options: AnalysisBudget & { start?: DamesState } = {}): GameAnalysis {
  return runSync(analyzeGameGen(variant, moves, options));
}

/* ------------------------------------------------------------------ */
/* Indice                                                               */

export type HintReason = 'only_move' | 'capture_majority' | 'capture' | 'promotion' | 'wins_material' | 'best';

export interface Hint {
  move: Move;
  notation: string;
  reason: HintReason;
  /** Score pour le camp au trait. */
  score: number;
  /** Suite prévue (notation officielle). */
  pv: string[];
}

export function* hintGen(state: DamesState, budget: AnalysisBudget = {}): Generator<void, Hint, void> {
  if (state.result) throw new Error('La partie est terminée');
  const pos = Position.fromState(state);
  const moves = pos.legalMoves();
  if (moves.length === 0) throw new Error('Aucun coup légal');
  const search = new Search(pos, {
    weights: defaultWeights(pos.g.size),
    maxDepth: budget.depth ?? 12,
    maxNodes: budget.maxNodesPerMove ?? 150_000,
    ...(budget.now ? { now: budget.now } : {}),
  });
  const r = yield* search.run();
  const best = r.best!;
  let reason: HintReason = 'best';
  if (moves.length === 1) reason = 'only_move';
  else if (best.caps.length > 0) reason = pos.g.majority && best.caps.length > 1 ? 'capture_majority' : 'capture';
  else if (pos.g.row[best.to] === pos.g.promoRow[pos.stm === 1 ? 0 : 1] && Math.abs(pos.b[best.from]!) === 1) reason = 'promotion';
  else if (r.score >= 90 && r.score < MATE_BOUND) reason = 'wins_material';
  else if (r.score >= MATE_BOUND) reason = 'wins_material';
  return {
    move: { from: best.from, to: best.to, path: [...best.path], captures: [...best.caps] },
    notation: emoveNotation(best),
    reason,
    score: r.score,
    pv: r.pv.map(emoveNotation),
  };
}

export function hint(state: DamesState, options: AnalysisBudget & AsyncDriveOptions = {}): Promise<Hint> {
  return runAsync(hintGen(state, options), options);
}

export function hintSync(state: DamesState, options: AnalysisBudget = {}): Hint {
  return runSync(hintGen(state, options));
}

/* ------------------------------------------------------------------ */
/* Taux d'accord avec le moteur (anti-triche)                           */

export interface AgreementOptions extends AnalysisBudget {
  /** Coups d'ouverture ignorés (théorie connue) : 5 coups de chaque camp par défaut. */
  skipOpeningMoves?: number;
  start?: DamesState;
  /** Temps de réflexion de chaque demi-coup du joueur analysé (ms), s'ils sont connus. */
  thinkTimesMs?: readonly number[];
}

export interface AgreementReport {
  side: Side;
  /** Coups pris en compte (non forcés, hors ouverture). */
  considered: number;
  /** Coups identiques au meilleur coup du moteur. */
  agreed: number;
  /** Coups à moins de 10 centièmes du meilleur. */
  nearBest: number;
  rate: number;
  averageLoss: number;
  skippedForced: number;
  /** Régularité des temps de réflexion (écart-type ÷ moyenne), null si inconnus. */
  thinkTimeVariation: number | null;
  /** Profil « trop parfait » : à passer en revue (jamais une sanction automatique). */
  reviewNeeded: boolean;
}

/**
 * Seuils de revue (décision) : au moins 15 coups pris en compte, et soit
 * ≥ 85 % d'accord avec une perte moyenne ≤ 15, soit ≥ 70 % d'accord avec des
 * temps de réflexion anormalement réguliers (variation < 0,25).
 */
export const REVIEW_THRESHOLDS = { minMoves: 15, rate: 0.85, averageLoss: 15, rateWithRegularTimes: 0.7, timeVariation: 0.25 } as const;

export function* agreementRateGen(variant: Variant, moves: readonly MoveInput[], side: Side, options: AgreementOptions = {}): Generator<void, AgreementReport, void> {
  const states = replay(variant, moves, options.start);
  const skip = 2 * (options.skipOpeningMoves ?? 5);
  let considered = 0;
  let agreed = 0;
  let nearBest = 0;
  let lossSum = 0;
  let skippedForced = 0;
  for (let i = 0; i < states.length - 1; i++) {
    const before = states[i]!;
    if (before.turn !== side || before.ply < skip) continue;
    const eb = yield* evalPosition(before, options);
    if (eb.legalCount <= 1) {
      skippedForced++;
      continue;
    }
    const ea = yield* evalPosition(states[i + 1]!, options);
    const played = movePlayed(before, states[i + 1]!);
    const loss = Math.max(0, eb.score + ea.score);
    considered++;
    lossSum += loss;
    if (emoveKey(played) === eb.bestKey) agreed++;
    if (loss <= QUALITY_THRESHOLDS.best || emoveKey(played) === eb.bestKey) nearBest++;
  }
  const rate = considered ? agreed / considered : 0;
  const averageLoss = considered ? lossSum / considered : 0;
  let thinkTimeVariation: number | null = null;
  const times = options.thinkTimesMs ?? [];
  if (times.length >= 5) {
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const sd = Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length);
    thinkTimeVariation = mean > 0 ? sd / mean : 0;
  }
  const t = REVIEW_THRESHOLDS;
  const reviewNeeded =
    considered >= t.minMoves &&
    ((rate >= t.rate && averageLoss <= t.averageLoss) || (thinkTimeVariation !== null && thinkTimeVariation < t.timeVariation && rate >= t.rateWithRegularTimes));
  return { side, considered, agreed, nearBest, rate, averageLoss: Math.round(averageLoss), skippedForced, thinkTimeVariation, reviewNeeded };
}

export function agreementRate(
  variant: Variant,
  moves: readonly MoveInput[],
  side: Side,
  options: AgreementOptions & AsyncDriveOptions = {},
): Promise<AgreementReport> {
  return runAsync(agreementRateGen(variant, moves, side, options), options);
}

export function agreementRateSync(variant: Variant, moves: readonly MoveInput[], side: Side, options: AgreementOptions = {}): AgreementReport {
  return runSync(agreementRateGen(variant, moves, side, options));
}
