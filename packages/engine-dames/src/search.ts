/**
 * Recherche alpha-bêta (planche Moteur, « Recherche ») :
 * - négamax avec fenêtre principale (PVS) et approfondissement itératif ;
 * - table de transposition indexée par les clés de Zobrist ;
 * - quiétude : les prises (obligatoires) ne sont jamais coupées à l'horizon ;
 * - ordre des coups : coup de la table, prises, promotions, coups « tueurs »,
 *   historique ; réductions des coups tardifs (désactivables) ;
 * - extension d'un coup forcé (un seul coup légal) ;
 * - limites de profondeur, de nœuds et de temps.
 *
 * La recherche est un générateur qui rend la main tous les `yieldEvery`
 * nœuds : la version asynchrone en profite pour laisser respirer l'interface
 * (React Native n'a pas de worker_threads), la version synchrone l'ignore.
 * À limites de nœuds égales, le résultat est identique (déterministe) ; la
 * limite de temps n'est qu'un garde-fou.
 */
import type { EMove, Position } from './core.js';
import { evaluate, type EvalWeights } from './evaluate.js';

export const MATE = 30000;
/** Au-delà, un score annonce un gain ou une perte forcée. */
export const MATE_BOUND = 29000;
export const INF = 32000;
const MAX_PLY = 120;

const EXACT = 1;
const LOWER = 2;
const UPPER = 3;

/** Table de transposition : tableaux typés, remplacement par profondeur. */
export class TranspositionTable {
  readonly size: number;
  private readonly mask: number;
  private readonly key1: Int32Array;
  private readonly key2: Int32Array;
  private readonly scores: Int32Array;
  private readonly depths: Int8Array;
  private readonly flags: Uint8Array;
  private readonly moves: Int32Array;

  constructor(bits = 18) {
    this.size = 1 << bits;
    this.mask = this.size - 1;
    this.key1 = new Int32Array(this.size);
    this.key2 = new Int32Array(this.size);
    this.scores = new Int32Array(this.size);
    this.depths = new Int8Array(this.size);
    this.flags = new Uint8Array(this.size);
    this.moves = new Int32Array(this.size);
  }

  clear(): void {
    this.flags.fill(0);
  }

  /** Index de l'entrée de cette position, ou −1. */
  probe(h1: number, h2: number): number {
    const i = h1 & this.mask;
    return this.flags[i] !== 0 && this.key1[i] === (h1 | 0) && this.key2[i] === (h2 | 0) ? i : -1;
  }

  store(h1: number, h2: number, depth: number, flag: number, score: number, move: number): void {
    const i = h1 & this.mask;
    const same = this.key1[i] === (h1 | 0) && this.key2[i] === (h2 | 0);
    if (this.flags[i] !== 0 && !same && this.depths[i]! > depth) return;
    this.key1[i] = h1 | 0;
    this.key2[i] = h2 | 0;
    this.depths[i] = Math.max(-128, Math.min(127, depth));
    this.flags[i] = flag;
    this.scores[i] = score;
    if (move !== 0 || !same) this.moves[i] = move;
  }

  depth(i: number): number {
    return this.depths[i]!;
  }
  flag(i: number): number {
    return this.flags[i]!;
  }
  score(i: number): number {
    return this.scores[i]!;
  }
  move(i: number): number {
    return this.moves[i]!;
  }
}

/** Code compact d'un coup pour la table et les coups tueurs (départ, arrivée). */
export function moveCode(m: EMove): number {
  return ((m.from << 8) | m.to) + 1;
}

export interface SearchOptions {
  weights: EvalWeights;
  /** Profondeur maximale en demi-coups (64 par défaut). */
  maxDepth?: number;
  /** Nœuds au plus (sans limite par défaut). */
  maxNodes?: number;
  /** Temps au plus, en millisecondes (garde-fou, sans limite par défaut). */
  timeMs?: number;
  /** Horloge (injectable pour les tests). */
  now?: () => number;
  /** Demi-coups de quiétude au plus ; 0 = l'horizon coupe les prises (échelons bas). */
  qDepth?: number;
  /**
   * Mode « plusieurs coups » : chaque coup de la racine reçoit un score exact
   * s'il est à moins de `multiMargin` du meilleur (niveaux humains, analyse).
   */
  multiMargin?: number | null;
  /** Réductions des coups tardifs (par défaut : oui, sauf en mode « plusieurs coups »). */
  reductions?: boolean;
  /** Rendre la main tous les n nœuds (2 048 par défaut). */
  yieldEvery?: number;
  tt?: TranspositionTable;
  /** Coups de la racine à considérer (par défaut : tous les coups légaux). */
  rootMoves?: EMove[];
}

export interface RootScore {
  move: EMove;
  score: number;
  /** Score exact (sinon : borne supérieure, le coup est moins bon). */
  exact: boolean;
}

export interface SearchResult {
  best: EMove | null;
  /** Score pour le camp au trait, en centièmes de pion (±MATE : gain ou perte forcée). */
  score: number;
  /** Dernière profondeur entièrement explorée. */
  depth: number;
  nodes: number;
  pv: EMove[];
  /** Scores de la racine, du meilleur au moins bon. */
  rootScores: RootScore[];
  /** Une limite (nœuds, temps) a interrompu la recherche. */
  stopped: boolean;
}

/** Taille de table adaptée au budget de nœuds. */
export function ttBitsFor(maxNodes: number): number {
  if (!Number.isFinite(maxNodes)) return 20;
  return Math.max(12, Math.min(20, Math.ceil(Math.log2(Math.max(1, maxNodes))) + 1));
}

export class Search {
  nodes = 0;
  stopped = false;
  private readonly pos: Position;
  private readonly weights: EvalWeights;
  private readonly maxDepth: number;
  private readonly maxNodes: number;
  private readonly timeMs: number;
  private readonly now: () => number;
  private readonly qDepth: number;
  private readonly multiMargin: number | null;
  private readonly reductions: boolean;
  private readonly yieldEvery: number;
  private readonly tt: TranspositionTable;
  private readonly rootMoves: EMove[] | undefined;
  private readonly killers = new Int32Array(MAX_PLY * 2 + 4);
  private readonly history: Int32Array;
  private start = 0;

  constructor(pos: Position, options: SearchOptions) {
    this.pos = pos;
    this.weights = options.weights;
    this.maxDepth = Math.max(1, Math.min(options.maxDepth ?? 64, MAX_PLY - 8));
    this.maxNodes = options.maxNodes ?? Infinity;
    this.timeMs = options.timeMs ?? Infinity;
    this.now = options.now ?? Date.now;
    this.qDepth = options.qDepth ?? MAX_PLY;
    this.multiMargin = options.multiMargin ?? null;
    this.reductions = options.reductions ?? this.multiMargin === null;
    this.yieldEvery = Math.max(64, options.yieldEvery ?? 2048);
    this.tt = options.tt ?? new TranspositionTable(ttBitsFor(this.maxNodes));
    this.rootMoves = options.rootMoves;
    const n = pos.g.n + 1;
    this.history = new Int32Array(256 * n);
  }

  private checkLimits(): void {
    if (this.nodes >= this.maxNodes) this.stopped = true;
    else if (this.timeMs !== Infinity && this.now() - this.start >= this.timeMs) this.stopped = true;
  }

  /** Recherche complète : approfondissement itératif. */
  *run(): Generator<void, SearchResult, void> {
    this.start = this.now();
    const pos = this.pos;
    const moves = this.rootMoves ?? pos.legalMoves();
    if (moves.length === 0) {
      return { best: null, score: -MATE, depth: 0, nodes: 0, pv: [], rootScores: [], stopped: false };
    }
    // Repli si même la première itération ne peut pas finir : un demi-coup statique.
    let completed = this.staticRoot(moves);
    let order = completed.rootScores.map((r) => r.move);
    for (let depth = 1; depth <= this.maxDepth; depth++) {
      const res = yield* this.root(depth, order);
      if (res === null) break;
      completed = res;
      order = res.rootScores.map((r) => r.move);
      if (this.stopped) break;
      // Gain ou perte forcée trouvée et confirmée : inutile d'aller plus loin.
      if (Math.abs(res.score) > MATE_BOUND && depth >= 2 && this.multiMargin === null) break;
      if (moves.length === 1 && depth >= 4 && this.multiMargin === null) break;
    }
    completed.nodes = this.nodes;
    completed.stopped = this.stopped;
    completed.pv = this.extractPv(completed.best, completed.depth);
    return completed;
  }

  private staticRoot(moves: EMove[]): SearchResult {
    const pos = this.pos;
    const scores: RootScore[] = moves.map((m) => {
      pos.make(m);
      const s = pos.legalMoves().length === 0 ? MATE - 1 : -evaluate(pos, this.weights);
      pos.unmake();
      return { move: m, score: s, exact: true };
    });
    scores.sort((a, b) => b.score - a.score);
    return { best: scores[0]!.move, score: scores[0]!.score, depth: 0, nodes: 0, pv: [], rootScores: scores, stopped: false };
  }

  /** Une itération à la racine ; null si elle a été interrompue. */
  private *root(depth: number, order: EMove[]): Generator<void, SearchResult | null, void> {
    const pos = this.pos;
    let alpha = -INF;
    const beta = INF;
    let best: EMove | null = null;
    let bestScore = -INF;
    const scores: RootScore[] = [];
    for (let i = 0; i < order.length; i++) {
      const m = order[i]!;
      pos.make(m);
      let score: number;
      let exact = true;
      if (this.multiMargin !== null) {
        const floor = bestScore === -INF ? -INF : bestScore - this.multiMargin - 1;
        score = -(yield* this.negamax(depth - 1, -beta, -floor, 1));
        exact = score > floor;
      } else if (i === 0) {
        score = -(yield* this.negamax(depth - 1, -beta, -alpha, 1));
      } else {
        score = -(yield* this.negamax(depth - 1, -alpha - 1, -alpha, 1));
        if (score > alpha && !this.stopped) score = -(yield* this.negamax(depth - 1, -beta, -alpha, 1));
        exact = score > alpha;
      }
      pos.unmake();
      if (this.stopped) return null;
      scores.push({ move: m, score, exact });
      if (score > bestScore) {
        bestScore = score;
        best = m;
        if (score > alpha) alpha = score;
      }
    }
    // Les coups à score exact d'abord (du meilleur au moins bon), puis les bornes.
    scores.sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact));
    if (best) this.tt.store(pos.h1, pos.h2, depth, EXACT, bestScore, moveCode(best));
    return { best, score: bestScore, depth, nodes: this.nodes, pv: [], rootScores: scores, stopped: false };
  }

  private *negamax(depth: number, alpha: number, beta: number, ply: number): Generator<void, number, void> {
    const pos = this.pos;
    if (++this.nodes % this.yieldEvery === 0) {
      this.checkLimits();
      yield;
    }
    if (this.stopped) return 0;
    if (pos.isRepetition() || pos.isQuietDraw()) return 0;
    if (depth <= 0 || ply >= MAX_PLY - 2) return this.quiesce(alpha, beta, ply, this.qDepth);

    const alphaOrig = alpha;
    let ttMove = 0;
    const e = this.tt.probe(pos.h1, pos.h2);
    if (e >= 0) {
      ttMove = this.tt.move(e);
      if (this.tt.depth(e) >= depth) {
        const s = fromTT(this.tt.score(e), ply);
        const f = this.tt.flag(e);
        if (f === EXACT) return s;
        if (f === LOWER && s >= beta) return s;
        if (f === UPPER && s <= alpha) return s;
      }
    }

    const moves = pos.legalMoves();
    if (moves.length === 0) return -MATE + ply;
    // Coup forcé : on ne compte pas ce demi-coup (extension), dans la limite de la moitié des plis.
    const next = moves.length === 1 && ply < MAX_PLY / 2 ? depth : depth - 1;
    this.order(moves, ttMove, ply);

    let best = -INF;
    let bestMove = 0;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]!;
      const quiet = m.caps.length === 0 && !this.promotes(m);
      const code = moveCode(m);
      pos.make(m);
      let score: number;
      if (i === 0) {
        score = -(yield* this.negamax(next, -beta, -alpha, ply + 1));
      } else {
        let r = 0;
        if (this.reductions && depth >= 3 && i >= 3 && quiet && code !== this.killers[ply * 2] && code !== this.killers[ply * 2 + 1]) {
          r = depth >= 6 && i >= 8 ? 2 : 1;
        }
        score = -(yield* this.negamax(next - r, -alpha - 1, -alpha, ply + 1));
        if (score > alpha && r > 0 && !this.stopped) score = -(yield* this.negamax(next, -alpha - 1, -alpha, ply + 1));
        if (score > alpha && score < beta && !this.stopped) score = -(yield* this.negamax(next, -beta, -alpha, ply + 1));
      }
      pos.unmake();
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        bestMove = code;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (quiet) {
              if (this.killers[ply * 2] !== code) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2]!;
                this.killers[ply * 2] = code;
              }
              const h = m.from * 256 + m.to;
              this.history[h] = Math.min(1 << 28, this.history[h]! + depth * depth);
            }
            break;
          }
        }
      }
    }
    const flag = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
    this.tt.store(pos.h1, pos.h2, depth, flag, toTT(best, ply), bestMove);
    return best;
  }

  /** Quiétude : les prises sont obligatoires, on les joue jusqu'au calme (pas de « stand pat » quand il faut prendre). */
  private quiesce(alpha: number, beta: number, ply: number, qLeft: number): number {
    const pos = this.pos;
    this.nodes++;
    if ((this.nodes & 4095) === 0) this.checkLimits();
    if (this.stopped) return 0;
    const caps: EMove[] = [];
    pos.genCaptures(caps);
    if (caps.length === 0) {
      if (!pos.hasQuietMove()) return -MATE + ply;
      return evaluate(pos, this.weights);
    }
    // Horizon des échelons bas : la prise à venir n'est pas vue.
    if (qLeft <= 0 || ply >= MAX_PLY - 1) return evaluate(pos, this.weights);
    if (caps.length > 1) caps.sort((a, b) => b.caps.length - a.caps.length);
    let best = -INF;
    for (const m of caps) {
      pos.make(m);
      const s = -this.quiesce(-beta, -alpha, ply + 1, qLeft - 1);
      pos.unmake();
      if (s > best) {
        best = s;
        if (s > alpha) {
          alpha = s;
          if (alpha >= beta) break;
        }
      }
    }
    return best;
  }

  private promotes(m: EMove): boolean {
    const pos = this.pos;
    const p = pos.b[m.from]!;
    if (p !== 1 && p !== -1) return false;
    return pos.g.row[m.to] === pos.g.promoRow[p === 1 ? 0 : 1];
  }

  private order(moves: EMove[], ttMove: number, ply: number): void {
    if (moves.length < 2) return;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    const keyed = moves.map((m, i) => {
      const code = moveCode(m);
      let s: number;
      if (code === ttMove) s = 1e9;
      else if (m.caps.length) s = 1e8 + m.caps.length * 1e6;
      else if (this.promotes(m)) s = 5e7;
      else if (code === k1) s = 4e7;
      else if (code === k2) s = 3e7;
      else s = this.history[m.from * 256 + m.to]!;
      return { m, s, i };
    });
    keyed.sort((a, b) => b.s - a.s || a.i - b.i);
    for (let i = 0; i < moves.length; i++) moves[i] = keyed[i]!.m;
  }

  /** Variante principale, lue dans la table de transposition. */
  private extractPv(first: EMove | null, depth: number): EMove[] {
    if (!first) return [];
    const pos = this.pos;
    const pv: EMove[] = [first];
    pos.make(first);
    const seen = new Set<string>();
    while (pv.length < Math.max(1, depth) && pv.length < 40) {
      const key = `${pos.h1}:${pos.h2}`;
      if (seen.has(key)) break;
      seen.add(key);
      const e = this.tt.probe(pos.h1, pos.h2);
      if (e < 0) break;
      const code = this.tt.move(e);
      const m = pos.legalMoves().find((x) => moveCode(x) === code);
      if (!m) break;
      pv.push(m);
      pos.make(m);
    }
    for (let i = 0; i < pv.length; i++) pos.unmake();
    return pv;
  }
}

function toTT(score: number, ply: number): number {
  if (score > MATE_BOUND) return score + ply;
  if (score < -MATE_BOUND) return score - ply;
  return score;
}

function fromTT(score: number, ply: number): number {
  if (score > MATE_BOUND) return score - ply;
  if (score < -MATE_BOUND) return score + ply;
  return score;
}

/** Fait tourner un générateur jusqu'au bout, sans rendre la main. */
export function runSync<T>(gen: Generator<void, T, void>): T {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

/** Jeton d'annulation minimal (compatible avec AbortSignal). */
export interface CancelToken {
  readonly aborted: boolean;
}

export class SearchCancelledError extends Error {
  constructor() {
    super('Recherche annulée');
    this.name = 'SearchCancelledError';
  }
}

export interface AsyncDriveOptions {
  /** Durée d'une tranche de calcul avant de rendre la main (12 ms par défaut). */
  sliceMs?: number;
  now?: () => number;
  /** Comment rendre la main (par défaut : setTimeout 0, disponible en React Native et sur le web). */
  yieldControl?: () => Promise<void>;
  signal?: CancelToken;
}

const defaultYield = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Fait tourner un générateur par tranches, en rendant la main entre deux tranches. */
export async function runAsync<T>(gen: Generator<void, T, void>, options: AsyncDriveOptions = {}): Promise<T> {
  const sliceMs = options.sliceMs ?? 12;
  const now = options.now ?? Date.now;
  const yieldControl = options.yieldControl ?? defaultYield;
  let sliceStart = now();
  let r = gen.next();
  while (!r.done) {
    if (options.signal?.aborted) {
      gen.return(undefined as never);
      throw new SearchCancelledError();
    }
    if (now() - sliceStart >= sliceMs) {
      await yieldControl();
      sliceStart = now();
      if (options.signal?.aborted) {
        gen.return(undefined as never);
        throw new SearchCancelledError();
      }
    }
    r = gen.next();
  }
  return r.value;
}
