/**
 * Tournois répartis sur plusieurs fils (worker_threads) : chaque fil joue les
 * donnes d'index ≡ i (mod n). Les joueurs sont décrits par des objets simples
 * (transmissibles aux fils), puis reconstruits en agents dans chaque fil.
 */
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  expectimaxAgent,
  heuristicAgent,
  mctsAgent,
  randomAgent,
  summarize,
  type GameResult,
  type Level,
  type MatchResult,
  type Player,
} from '@kwatt/ludo-ai';
import type { NewGameOptions } from '@kwatt/rules-ludo';

export type PlayerSpec =
  | { kind: 'level'; level: Level; label?: string; iters?: number; budgetMs?: number }
  | { kind: 'random'; label?: string }
  | { kind: 'heuristic'; threats: 'exact' | 'fast' | 'none'; temperature?: number; label?: string }
  | { kind: 'expectimax'; mode: 'maxn' | 'paranoid'; depth: number; label?: string; iters?: number; weights?: Record<string, number> }
  | { kind: 'mcts'; iters: number; label?: string; c?: number; rollout?: number };

export function specLabel(s: PlayerSpec): string {
  if (s.label) return s.label;
  switch (s.kind) {
    case 'level':
      return s.level + (s.iters ? `(${s.iters})` : '');
    case 'random':
      return 'aléatoire';
    case 'heuristic':
      return `heuristique-${s.threats}`;
    case 'expectimax':
      return `expectimax-${s.mode}-d${s.depth}` + (s.weights ? `[${Object.entries(s.weights).map(([k, v]) => `${k}=${v}`).join(',')}]` : '');
    case 'mcts':
      return `mcts-${s.iters}`;
  }
}

/** Joueur du banc d'essai à partir de sa description. */
export function toPlayer(s: PlayerSpec): Player {
  const label = specLabel(s);
  switch (s.kind) {
    case 'level':
      return { label, level: s.level, ...(s.iters !== undefined ? { maxIterations: s.iters } : {}), ...(s.budgetMs !== undefined ? { budgetMs: s.budgetMs } : {}) };
    case 'random':
      return { label, agent: randomAgent() };
    case 'heuristic':
      return { label, agent: heuristicAgent({ threats: s.threats, temperature: s.temperature ?? 0 }) };
    case 'expectimax':
      return { label, agent: expectimaxAgent({ mode: s.mode, depth: s.depth, ...(s.weights ? { weights: s.weights } : {}) }), maxIterations: s.iters ?? 1_000_000 };
    case 'mcts':
      return { label, agent: mctsAgent({ ...(s.c !== undefined ? { c: s.c } : {}), ...(s.rollout !== undefined ? { rolloutDecisions: s.rollout } : {}) }), maxIterations: s.iters };
  }
}

export interface PoolJob {
  game: NewGameOptions;
  lineup: PlayerSpec[];
  deals: number;
  seed: number;
}

/** Nombre de fils par défaut : la moitié des processeurs (la machine est partagée), au moins 1. */
export function defaultWorkers(): number {
  return Math.max(1, Math.min(3, Math.floor(cpus().length / 2)));
}

/** Joue un tournoi sur `workers` fils et rassemble les résultats. */
export async function runPooled(job: PoolJob, workers = defaultWorkers()): Promise<MatchResult> {
  const count = Math.max(1, Math.min(workers, job.deals));
  const parts = await Promise.all(
    Array.from(
      { length: count },
      (_, index) =>
        new Promise<GameResult[]>((resolve, reject) => {
          const w = new Worker(new URL('./worker.js', import.meta.url), { workerData: { job, shard: { index, count } } });
          w.once('message', (results: GameResult[]) => resolve(results));
          w.once('error', reject);
          w.once('exit', (code) => {
            if (code !== 0) reject(new Error(`fil ${index} arrêté (${code})`));
          });
        }),
    ),
  );
  return summarize(job.lineup.map(toPlayer), parts.flat());
}

/** Vrai si ce module est le script lancé (node dist/cli/<nom>.js). */
export function isMain(url: string): boolean {
  return !!process.argv[1] && fileURLToPath(url) === resolve(process.argv[1]);
}
