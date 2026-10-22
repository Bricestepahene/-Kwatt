/**
 * MCTS (UCT « en boucle ouverte ») sous budget de temps.
 *
 * Les lancers sont tirés à chaque simulation (nœuds de hasard échantillonnés) :
 * un nœud de l'arbre est une suite d'actions, et une action est « bouger le
 * pion qui est sur telle progression ». Chaque simulation descend l'arbre par
 * UCB1 (chaque joueur choisit pour son camp : max-n), joue ensuite quelques
 * tours avec une politique rapide guidée par l'heuristique, puis évalue la
 * position (`utilities`). La racine garde le coup le plus visité.
 *
 * La machine tire ses simulations avec son propre générateur à graine : elle
 * ne voit jamais le dé de la partie.
 */
import {
  absoluteSquare,
  applyLegalMove,
  applyRoll,
  BASE,
  distinctMoves,
  finish,
  isSafeSquare,
  lastTrack,
  legalMoves,
  throwDistribution,
  type LudoMove,
  type LudoState,
} from '@kwatt/rules-ludo';
import { DEFAULT_WEIGHTS, squash, tokenValue, utilities, type EvalWeights } from '../position.js';
import { sample, type Rng } from '../rng.js';
import type { Agent, AgentContext, Candidate, Decision } from '../types.js';

export interface MctsOptions {
  /** Constante d'exploration d'UCB1. */
  c?: number;
  /** Décisions jouées par la politique rapide après l'arbre, avant l'évaluation. */
  rolloutDecisions?: number;
  /** Part de coups au hasard dans la politique rapide. */
  epsilon?: number;
  /** Profondeur maximale de l'arbre (en décisions). */
  treeDepth?: number;
  /** Simulations au minimum, même si le budget est dépassé. */
  minSims?: number;
  weights?: Partial<EvalWeights>;
  /** Évaluation en fin de simulation (une utilité par siège) ; par défaut `utilities`. */
  evaluate?: (state: LudoState) => number[];
}

interface Edge {
  visits: number;
  total: number;
  node: TreeNode;
}

interface TreeNode {
  visits: number;
  edges: Map<string, Edge>;
}

const newNode = (): TreeNode => ({ visits: 0, edges: new Map() });

/** Action stable d'une simulation à l'autre : le pion qui est sur cette progression. */
const actionKey = (m: LudoMove): string => `${m.seat}:${m.from}`;

/** Politique rapide : capture, rentrée, couloir, sortie, case protégée, puis progression, avec un peu de hasard. */
export function fastPolicyScore(state: LudoState, m: LudoMove): number {
  const end = finish(state.config);
  let s = 0;
  for (const c of m.captures) s += 2 + tokenValue(state, state.tokens[c.seat]![c.token]!);
  if (m.to === end) s += 1.5;
  else if (m.to > lastTrack(state.config) && m.from <= lastTrack(state.config)) s += 1;
  if (m.from === BASE) s += 0.8;
  const sq = absoluteSquare(state.config, state.seats[m.seat]!.home, m.to);
  if (sq !== null && isSafeSquare(state.config, sq)) s += 0.3;
  return s + (m.to - Math.max(m.from, 0)) / (end + 1);
}

function policyMove(state: LudoState, moves: LudoMove[], rng: Rng, epsilon: number): LudoMove {
  if (moves.length === 1 || rng.next() < epsilon) return moves[rng.int(moves.length)]!;
  let best = moves[0]!;
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = fastPolicyScore(state, m);
    if (s > bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}

export function mctsAgent(options: MctsOptions = {}, id = 'mcts@1'): Agent {
  const c = options.c ?? 0.7;
  const rolloutDecisions = options.rolloutDecisions ?? 8;
  const epsilon = options.epsilon ?? 0.15;
  const treeDepth = options.treeDepth ?? 6;
  const minSims = options.minSims ?? 64;
  const w: EvalWeights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const evaluate = options.evaluate ?? ((s: LudoState): number[] => utilities(s, w));
  return {
    id,
    choose(root: LudoState, moves: LudoMove[], ctx: AgentContext): Decision {
      const dist = throwDistribution(root.config.mechanics.throw);
      const tree = newNode();
      const rootKeys = moves.map(actionKey);
      let sims = 0;
      let nodes = 0;
      // Avec un plafond d'itérations, on ignore l'horloge : la recherche est reproductible.
      const maxSims = ctx.maxIterations ?? Infinity;
      const timed = ctx.maxIterations === undefined;
      while (sims < maxSims && (!timed || sims < minSims || (sims & 15) !== 0 || ctx.now() < ctx.deadline)) {
        sims++;
        let s = root;
        let node = tree;
        const path: { edge: Edge; mover: number; parent: TreeNode }[] = [];
        let depth = 0;
        // 1. Descente dans l'arbre.
        while (s.phase !== 'over' && depth < treeDepth) {
          if (s.phase === 'roll') {
            s = applyRoll(s, sample(dist, ctx.rng));
            continue;
          }
          const legal = node === tree ? moves : distinctMoves(legalMoves(s));
          if (legal.length === 1 && node !== tree) {
            s = applyLegalMove(s, legal[0]!);
            continue;
          }
          const mover = s.current;
          let pick: LudoMove | null = null;
          let pickEdge: Edge | null = null;
          let bestUcb = -Infinity;
          for (const m of legal) {
            const key = actionKey(m);
            const e = node.edges.get(key);
            if (!e || e.visits === 0) {
              // Action jamais essayée : on l'essaie d'abord (la meilleure selon la politique rapide).
              const u = 1e6 + fastPolicyScore(s, m);
              if (u > bestUcb) {
                bestUcb = u;
                pick = m;
                pickEdge = e ?? null;
              }
              continue;
            }
            const u = e.total / e.visits + c * Math.sqrt(Math.log(node.visits + 1) / e.visits);
            if (u > bestUcb) {
              bestUcb = u;
              pick = m;
              pickEdge = e;
            }
          }
          const key = actionKey(pick!);
          if (!pickEdge) {
            pickEdge = { visits: 0, total: 0, node: newNode() };
            node.edges.set(key, pickEdge);
            nodes++;
          }
          path.push({ edge: pickEdge, mover, parent: node });
          s = applyLegalMove(s, pick!);
          depth++;
          const fresh = pickEdge.visits === 0;
          node = pickEdge.node;
          if (fresh) break;
        }
        // 2. Simulation rapide de quelques décisions.
        let left = rolloutDecisions;
        while (s.phase !== 'over' && left > 0) {
          if (s.phase === 'roll') {
            s = applyRoll(s, sample(dist, ctx.rng));
            continue;
          }
          s = applyLegalMove(s, policyMove(s, legalMoves(s), ctx.rng, epsilon));
          left--;
        }
        // 3. Évaluation et remontée (chaque joueur compte pour lui : max-n).
        const u = evaluate(s);
        for (const step of path) {
          step.edge.visits++;
          step.edge.total += squash(u[step.mover]!);
          step.parent.visits++;
        }
      }
      const candidates: Candidate[] = moves.map((move, i) => {
        const e = tree.edges.get(rootKeys[i]!);
        const visits = e?.visits ?? 0;
        const ev = visits > 0 ? e!.total / visits : 0;
        return { move, score: visits, ev, visits };
      });
      let best = 0;
      for (let i = 1; i < candidates.length; i++) {
        const a = candidates[i]!;
        const b = candidates[best]!;
        if (a.visits! > b.visits! || (a.visits === b.visits && a.ev! > b.ev!)) best = i;
      }
      return { move: moves[best]!, candidates, stats: { sims, nodes, depth: treeDepth } };
    },
  };
}
