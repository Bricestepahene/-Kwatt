/**
 * Choisir un coup : pleine force (Fon) ou comme un humain d'un échelon donné.
 *
 * `chooseMove(state, { targetRating, timeMs, seed })` est asynchrone et
 * découpé en tranches (l'interface React Native reste fluide, sans
 * worker_threads) ; `chooseMoveSync` fait le même calcul d'un bloc (serveur,
 * tests). À graine et budgets égaux, les deux rendent le même coup.
 */
import { findLegal, type DamesState, type Move } from '@kwatt/rules-dames';
import { Position, emoveKey, emoveNotation, type EMove } from './core.js';
import { defaultWeights } from './evaluate.js';
import { levelProfile, levelWeights, type LevelId, type LevelProfile } from './levels.js';
import { gaussian, mixSeed, mulberry32 } from './random.js';
import { MATE_BOUND, Search, runAsync, runSync, type AsyncDriveOptions, type RootScore } from './search.js';

export interface ChooseMoveOptions extends AsyncDriveOptions {
  /** Force visée (Elo du domaine) ; absente : pleine force. */
  targetRating?: number | null;
  /** Garde-fou de temps (ms) : au-delà, le meilleur coup de la dernière itération complète. */
  timeMs?: number;
  /** Budget de nœuds (remplace celui du niveau). */
  maxNodes?: number;
  /** Graine : même graine, même position → même coup. */
  seed?: number;
}

export interface EngineChoice {
  /** Coup légal au sens de @kwatt/rules-dames. */
  move: Move;
  notation: string;
  /** Score vu par le moteur pour le camp qui joue (centièmes de pion). */
  score: number;
  depth: number;
  nodes: number;
  level: LevelId;
  /** Meilleur coup vu par la recherche de ce niveau. */
  bestNotation: string;
  /** Le coup joué n'est pas le meilleur vu : erreur « humaine » voulue (bruit). */
  deliberate: boolean;
  /** Variante principale prévue (notation officielle). */
  pv: string[];
}

/** Profondeur de la vérification « jamais un coup absurde » des échelons bas. */
const CHECK_DEPTH = 4;
const CHECK_NODES = 60_000;

function toChoice(state: DamesState, m: EMove, extra: Omit<EngineChoice, 'move' | 'notation'>): EngineChoice {
  const legal = findLegal(state, { from: m.from, to: m.to, captures: m.caps });
  // Garde-fou : le moteur ne rend jamais un coup que rules-dames refuserait.
  if (!legal) throw new Error(`Coup du moteur illégal : ${emoveNotation(m)}`);
  return { move: legal, notation: emoveNotation(m), ...extra };
}

export function* chooseMoveGen(state: DamesState, options: ChooseMoveOptions = {}): Generator<void, EngineChoice, void> {
  if (state.result) throw new Error('La partie est terminée');
  const pos = Position.fromState(state);
  const moves = pos.legalMoves();
  if (moves.length === 0) throw new Error('Aucun coup légal');
  const profile = levelProfile(options.targetRating);
  const base = { level: profile.id, depth: 0, nodes: 0, pv: [] as string[], deliberate: false };
  if (moves.length === 1) {
    const only = moves[0]!;
    return toChoice(state, only, { ...base, score: 0, bestNotation: emoveNotation(only) });
  }
  const now = options.now ?? Date.now;
  const common = { now, ...(options.timeMs !== undefined ? { timeMs: options.timeMs } : {}) };

  if (profile.full) {
    const search = new Search(pos, {
      ...common,
      weights: defaultWeights(pos.g.size),
      maxDepth: profile.depth,
      maxNodes: options.maxNodes ?? profile.maxNodes,
    });
    const r = yield* search.run();
    const best = r.best!;
    return toChoice(state, best, {
      ...base,
      score: r.score,
      depth: r.depth,
      nodes: r.nodes,
      bestNotation: emoveNotation(best),
      pv: r.pv.map(emoveNotation),
    });
  }

  // 1. Ce que voit ce niveau : profondeur, quiétude et poids dégradés.
  // Avec une limite de temps : trois quarts pour la vision, le reste pour la vérification.
  const started = now();
  const vision = new Search(pos, {
    now,
    ...(options.timeMs !== undefined ? { timeMs: Math.max(1, Math.floor(options.timeMs * 0.75)) } : {}),
    weights: levelWeights(profile, pos.g.size),
    maxDepth: profile.depth,
    qDepth: profile.qDepth,
    maxNodes: options.maxNodes ?? profile.maxNodes,
    multiMargin: profile.cap + 3 * profile.noise,
  });
  const seen = yield* vision.run();
  let nodes = seen.nodes;

  // 2. Jamais un coup absurde : vérification indépendante (pleins poids, pleine quiétude).
  const left = options.timeMs !== undefined ? { timeMs: Math.max(1, options.timeMs - (now() - started)) } : {};
  const allowed = yield* allowedMoves(pos, profile, seen.rootScores, { now, ...left });
  nodes += allowed.nodes;

  // 3. Choix : meilleur score vu + bruit (graine et position → même tirage).
  const random = mulberry32(mixSeed(options.seed ?? 0, mixSeed(pos.h1, pos.h2)));
  let pick: RootScore | null = null;
  let pickValue = -Infinity;
  for (const r of seen.rootScores) {
    const noise = profile.noise > 0 ? gaussian(random) * profile.noise : 0;
    if (!allowed.keys.has(emoveKey(r.move))) continue;
    const value = r.score + noise;
    if (value > pickValue) {
      pickValue = value;
      pick = r;
    }
  }
  const chosen = pick ?? seen.rootScores[0]!;
  const best = seen.rootScores[0]!.move;
  return toChoice(state, chosen.move, {
    ...base,
    score: chosen.score,
    depth: seen.depth,
    nodes,
    bestNotation: emoveNotation(best),
    deliberate: emoveKey(chosen.move) !== emoveKey(best),
    pv: chosen.move === best ? seen.pv.map(emoveNotation) : [emoveNotation(chosen.move)],
  });
}

function* allowedMoves(
  pos: Position,
  profile: LevelProfile,
  vision: RootScore[],
  common: { now: () => number; timeMs?: number },
): Generator<void, { keys: Set<string>; nodes: number }, void> {
  // Les niveaux qui voient loin, avec la quiétude complète, servent de vérification à eux-mêmes.
  let scores = vision;
  let nodes = 0;
  if (profile.depth < CHECK_DEPTH || profile.qDepth < 8) {
    const check = new Search(pos, {
      ...common,
      weights: defaultWeights(pos.g.size),
      maxDepth: CHECK_DEPTH,
      maxNodes: CHECK_NODES,
      multiMargin: profile.cap,
    });
    const r = yield* check.run();
    scores = r.rootScores;
    nodes = r.nodes;
  }
  const top = scores[0]!.score;
  const keys = new Set<string>();
  for (const r of scores) {
    // Un coup qui perd la partie quand un autre la sauve est toujours absurde.
    const lostGame = r.score < -MATE_BOUND && top > -MATE_BOUND;
    if (r.exact && r.score >= top - profile.cap && !lostGame) keys.add(emoveKey(r.move));
  }
  if (keys.size === 0) keys.add(emoveKey(scores[0]!.move));
  return { keys, nodes };
}

/** Choisit un coup sans bloquer l'interface (calcul découpé en tranches). */
export function chooseMove(state: DamesState, options: ChooseMoveOptions = {}): Promise<EngineChoice> {
  return runAsync(chooseMoveGen(state, options), options);
}

/** Même calcul d'un seul bloc (serveur, tests). */
export function chooseMoveSync(state: DamesState, options: ChooseMoveOptions = {}): EngineChoice {
  return runSync(chooseMoveGen(state, options));
}
