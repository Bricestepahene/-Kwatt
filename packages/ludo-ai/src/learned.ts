/**
 * Évaluation apprise (auto-jeu, research/ludo) : un modèle linéaire sur des
 * caractéristiques simples d'une position, exporté en JSON par Python et
 * chargé ici. Les mêmes caractéristiques sont calculées des deux côtés (les
 * fixtures d'or les contiennent, ce qui vérifie l'accord).
 */
import { absoluteSquare, BASE, finish, isSafeSquare, lastTrack, teamOf, type LudoState, type Preset } from '@kwatt/rules-ludo';
import { progressOnSquare } from './position.js';

export const LEARNED_FEATURES = ['progress', 'base', 'home', 'corridor', 'exposed'] as const;
export type LearnedFeature = (typeof LEARNED_FEATURES)[number];

/**
 * Caractéristiques d'un siège, chacune ramenée entre 0 et 1 :
 * progression moyenne, part des pions à la base, rentrés, dans le couloir,
 * et exposés (sur une case non protégée avec un adversaire 1 à 6 cases derrière).
 */
export function stateFeatures(state: LudoState, seat: number): number[] {
  const end = finish(state.config);
  const lt = lastTrack(state.config);
  const list = state.tokens[seat]!;
  const n = list.length;
  const home = state.seats[seat]!.home;
  let progress = 0;
  let base = 0;
  let done = 0;
  let corridor = 0;
  let exposed = 0;
  for (const p of list) {
    if (p === BASE) {
      base++;
      continue;
    }
    progress += (p + 1) / (end + 1);
    if (p === end) done++;
    else if (p > lt) corridor++;
    const sq = absoluteSquare(state.config, home, p);
    if (sq === null || isSafeSquare(state.config, sq)) continue;
    let threatened = false;
    state.tokens.forEach((other, o) => {
      if (threatened || teamOf(state, o) === teamOf(state, seat) || state.seats[o]!.status !== 'playing') return;
      const q = progressOnSquare(state, state.seats[o]!.home, sq);
      if (q === null) return;
      for (const op of other) {
        if (op !== BASE && op < q && q - op <= 6 && absoluteSquare(state.config, state.seats[o]!.home, op) !== null) threatened = true;
      }
    });
    if (threatened) exposed++;
  }
  return [progress / n, base / n, done / n, corridor / n, exposed / n];
}

export interface LinearModel {
  format: 'kwatt-ludo-eval';
  version: 1;
  /** Variante sur laquelle le modèle a été entraîné. */
  preset: Preset;
  features: string[];
  weights: number[];
  bias?: number;
  /** Informations d'entraînement (parties, date…), libres. */
  meta?: Record<string, unknown>;
}

export function isLinearModel(value: unknown): value is LinearModel {
  const v = value as Partial<LinearModel> | null;
  return (
    !!v &&
    v.format === 'kwatt-ludo-eval' &&
    v.version === 1 &&
    Array.isArray(v.features) &&
    Array.isArray(v.weights) &&
    v.features.length === v.weights.length &&
    v.features.every((f) => (LEARNED_FEATURES as readonly string[]).includes(f)) &&
    v.weights.every((w) => typeof w === 'number' && Number.isFinite(w))
  );
}

/**
 * Fonction d'évaluation (une utilité par siège) tirée d'un modèle :
 * w · (caractéristiques du siège − moyenne des adversaires) + biais.
 * Partie finie : +12 au camp gagnant, −12 aux autres (comme `utilities`).
 */
export function linearEvaluator(model: LinearModel): (state: LudoState) => number[] {
  if (!isLinearModel(model)) throw new Error('ludo_ai.invalid_model');
  const index = model.features.map((f) => LEARNED_FEATURES.indexOf(f as LearnedFeature));
  const bias = model.bias ?? 0;
  return (state) => {
    const n = state.seats.length;
    if (state.phase === 'over') {
      const winner = teamOf(state, state.ranking[0]!);
      return Array.from({ length: n }, (_, s) => (teamOf(state, s) === winner ? 12 : -12));
    }
    const f = state.seats.map((_, s) => stateFeatures(state, s));
    return Array.from({ length: n }, (_, s) => {
      const opp = f.filter((_, o) => teamOf(state, o) !== teamOf(state, s));
      let u = bias;
      index.forEach((k, j) => {
        const mean = opp.length > 0 ? opp.reduce((a, x) => a + x[k]!, 0) / opp.length : 0;
        u += model.weights[j]! * (f[s]![k]! - mean);
      });
      return u;
    });
  };
}
