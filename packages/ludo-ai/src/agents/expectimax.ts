/**
 * Expectimax à profondeur réduite : nœuds de hasard pour chaque lancer (dé ou
 * cauris, probabilités exactes), nœuds de décision pour chaque joueur.
 *
 * À plus de deux camps, ce n'est pas un minimax. Deux hypothèses sur les
 * adversaires :
 * - max-n : chacun joue au mieux pour lui (son utilité) ;
 * - paranoïaque : tous jouent contre la machine (ils minimisent son utilité).
 * Le banc d'essai garde la meilleure mesurée (voir CALIBRATION.md).
 *
 * Approfondissement itératif sous budget de temps : la profondeur terminée la
 * plus grande donne le coup.
 */
import { applyLegalMove, applyRoll, distinctMoves, legalMoves, throwDistribution, type LudoMove, type LudoState } from '@kwatt/rules-ludo';
import { campOf, DEFAULT_WEIGHTS, utilities, type EvalWeights } from '../position.js';
import type { Agent, AgentContext, Candidate, Decision } from '../types.js';

export type OpponentModel = 'maxn' | 'paranoid';

export interface ExpectimaxOptions {
  /** Profondeur maximale, en décisions (1 = évaluer juste après le coup). */
  depth?: number;
  /** Profondeur à atteindre même si le budget est dépassé. */
  minDepth?: number;
  mode?: OpponentModel;
  weights?: Partial<EvalWeights>;
  /** Évaluation des feuilles (une utilité par siège) ; par défaut `utilities` (ou un modèle appris, voir learned.ts). */
  evaluate?: (state: LudoState) => number[];
}

class Timeout extends Error {}

interface Ctx {
  me: number;
  mode: OpponentModel;
  evaluate: (state: LudoState) => number[];
  nodes: number;
  deadline: number;
  now: () => number;
  /** Profondeur obligatoire : pas de coupure au temps. */
  mandatory: boolean;
  maxNodes: number;
}

function check(ctx: Ctx): void {
  ctx.nodes++;
  if (ctx.mandatory) return;
  // Avec un plafond de nœuds, on ignore l'horloge : la recherche est reproductible.
  if (Number.isFinite(ctx.maxNodes)) {
    if (ctx.nodes > ctx.maxNodes) throw new Timeout();
  } else if ((ctx.nodes & 63) === 0 && ctx.now() > ctx.deadline) throw new Timeout();
}

/** Valeur (utilité de chaque siège) d'une position, à `depth` décisions de profondeur. */
function value(state: LudoState, depth: number, chanceLeft: number, ctx: Ctx): number[] {
  check(ctx);
  if (state.phase === 'over' || depth <= 0) return ctx.evaluate(state);
  if (state.phase === 'roll') {
    // Lancers sans coup possible : on n'enchaîne pas indéfiniment les nœuds de hasard.
    if (chanceLeft <= 0) return ctx.evaluate(state);
    const acc = new Array<number>(state.seats.length).fill(0);
    for (const { value: v, p } of throwDistribution(state.config.mechanics.throw)) {
      const r = value(applyRoll(state, v), depth, chanceLeft - 1, ctx);
      for (let i = 0; i < acc.length; i++) acc[i]! += p * r[i]!;
    }
    return acc;
  }
  const mover = state.current;
  const moves = distinctMoves(legalMoves(state));
  let best: number[] | null = null;
  const friendly = campOf(state, mover) === campOf(state, ctx.me);
  for (const m of moves) {
    const r = value(applyLegalMove(state, m), depth - 1, depth, ctx);
    if (best === null) best = r;
    else if (ctx.mode === 'maxn' || friendly) {
      const who = ctx.mode === 'maxn' ? mover : ctx.me;
      if (r[who]! > best[who]!) best = r;
    } else if (r[ctx.me]! < best[ctx.me]!) best = r;
  }
  return best ?? ctx.evaluate(state);
}

export function expectimaxAgent(options: ExpectimaxOptions = {}, id?: string): Agent {
  const maxDepth = options.depth ?? 2;
  const minDepth = Math.min(options.minDepth ?? 1, maxDepth);
  const mode = options.mode ?? 'paranoid';
  const w: EvalWeights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const evaluate = options.evaluate ?? ((s: LudoState): number[] => utilities(s, w));
  return {
    id: id ?? `expectimax-${mode}-d${maxDepth}@1`,
    choose(state: LudoState, moves: LudoMove[], actx: AgentContext): Decision {
      const ctx: Ctx = {
        me: actx.seat,
        mode,
        evaluate,
        nodes: 0,
        deadline: actx.deadline,
        now: actx.now,
        mandatory: true,
        maxNodes: actx.maxIterations ?? Infinity,
      };
      let done: { depth: number; values: number[] } | null = null;
      for (let depth = 1; depth <= maxDepth; depth++) {
        ctx.mandatory = depth <= minDepth;
        try {
          const values = moves.map((m) => value(applyLegalMove(state, m), depth - 1, depth, ctx)[actx.seat]!);
          done = { depth, values };
        } catch (e) {
          if (e instanceof Timeout) break;
          throw e;
        }
      }
      const { depth, values } = done!;
      let best = 0;
      for (let i = 1; i < values.length; i++) if (values[i]! > values[best]! + 1e-12) best = i;
      const candidates: Candidate[] = moves.map((move, i) => ({ move, score: values[i]!, ev: values[i]! }));
      return { move: moves[best]!, candidates, stats: { nodes: ctx.nodes, depth } };
    },
  };
}
