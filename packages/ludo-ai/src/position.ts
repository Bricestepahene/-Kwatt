/**
 * Lecture d'une position : valeur des pions, menaces approchées, évaluation
 * statique (un nombre par siège). Sert aux feuilles de l'expectimax, aux
 * simulations du MCTS et à la politique rapide.
 */
import {
  absoluteSquare,
  BASE,
  finish,
  isGrace,
  isSafeSquare,
  lastTrack,
  startSquare,
  teamOf,
  throwDistribution,
  trackLength,
  trackStart,
  type LudoState,
} from '@kwatt/rules-ludo';

export interface EvalWeights {
  /** Pion sorti de la base. */
  out: number;
  /** Pion à l'abri dans une partie privée (couloir final, descente du Pachisi). */
  safeZone: number;
  /** Pion rentré. */
  home: number;
  /** Poids de la perte attendue (probabilité d'être pris × valeur du pion). */
  risk: number;
  /** Poids des pions du partenaire dans la valeur d'un camp. */
  partner: number;
  /** Agrégation des adversaires : 0 = moyenne, 1 = le plus fort, entre les deux = mélange. */
  oppMax: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = { out: 0.2, safeZone: 0.12, home: 0.25, risk: 1, partner: 1, oppMax: 0.5 };

/** Probabilités d'un lancer, indexées par valeur (0 … 25). */
export function throwProbabilities(state: LudoState): Float64Array {
  const p = new Float64Array(26);
  for (const { value, p: q } of throwDistribution(state.config.mechanics.throw)) p[value] = q;
  return p;
}

/** Valeurs qui donnent un lancer de plus au joueur qui les fait. */
export function extraThrowValues(state: LudoState): number[] {
  const m = state.config.mechanics;
  if (m.throw === 'dice') return m.sixRollsAgain ? [6] : [];
  return m.graceRollsAgain ? [6, 10, 25].filter(isGrace) : [];
}

/** Valeur d'un pion selon sa progression (0 à la base, 1 + bonus une fois rentré). */
export function tokenValue(state: LudoState, progress: number, w: EvalWeights = DEFAULT_WEIGHTS): number {
  if (progress === BASE) return 0;
  const end = finish(state.config);
  if (progress >= end) return 1 + w.out + w.home;
  const base = w.out + (progress + 1) / (end + 1);
  const onTrack = progress >= trackStart(state.config) && progress <= lastTrack(state.config);
  return onTrack ? base : base + w.safeZone;
}

/** Progression à laquelle une maison passe sur une case absolue de piste (null si elle n'y passe pas). */
export function progressOnSquare(state: LudoState, home: number, square: number): number | null {
  const L = trackLength(state.config);
  const rel = (((square - startSquare(state.config, home)) % L) + L) % L;
  const p = trackStart(state.config) + rel;
  return p <= lastTrack(state.config) ? p : null;
}

/** Les camps : une équipe, ou un joueur seul. */
export function campOf(state: LudoState, seat: number): number {
  return teamOf(state, seat);
}

export function campsOf(state: LudoState): number[] {
  return [...new Set(state.seats.map((_, i) => campOf(state, i)))];
}

/**
 * Carte des menaces approchée : pour chaque siège adverse, la probabilité
 * qu'il puisse atteindre chaque case de piste à son prochain tour (lancer
 * direct, ou lancer de plus après un 6 / une grâce, ou sortie puis lancer).
 * Les barrières sont ignorées : c'est une estimation rapide. La probabilité
 * exacte, elle, est dans `threats.ts`.
 */
export function reachMap(state: LudoState): Float64Array[] {
  const L = trackLength(state.config);
  const P = throwProbabilities(state);
  const extras = extraThrowValues(state);
  const values = throwDistribution(state.config.mechanics.throw).map((x) => x.value);
  const m = state.config.mechanics;
  const exitExtras = m.exitRolls.filter((e) => extras.includes(e));
  const ts = trackStart(state.config);
  const lt = lastTrack(state.config);
  return state.seats.map((seat, s) => {
    const out = new Float64Array(L);
    if (seat.status !== 'playing') return out;
    // Distances atteignables vers chaque case, par pion.
    const dists = new Map<number, Set<number>>();
    const add = (q: number, d: number): void => {
      if (q < ts || q > lt) return;
      const sq = absoluteSquare(state.config, seat.home, q)!;
      let set = dists.get(sq);
      if (!set) dists.set(sq, (set = new Set()));
      set.add(d);
    };
    const maxReach = 25 + 25;
    let inBase = false;
    for (const p of state.tokens[s]!) {
      if (p === BASE) {
        inBase = true;
        continue;
      }
      if (p > lt) continue;
      for (let d = 1; d <= maxReach && p + d <= lt; d++) add(p + d, d);
    }
    for (const [sq, set] of dists) {
      let prob = 0;
      for (const v of values) if (set.has(v)) prob += P[v]!;
      for (const g of extras) {
        if (set.has(g)) continue;
        let second = 0;
        for (const v of values) if (set.has(g + v)) second += P[v]!;
        prob += P[g]! * second;
      }
      out[sq] = Math.min(1, prob);
    }
    // Pions à la base : sortie qui rejoue (6, grâce), puis lancer depuis le départ.
    if (inBase && exitExtras.length > 0) {
      const pe = exitExtras.reduce((a, e) => a + P[e]!, 0);
      for (const v of values) {
        const q = v;
        if (q < ts || q > lt) continue;
        const sq = absoluteSquare(state.config, seat.home, q)!;
        out[sq] = Math.min(1, out[sq]! + pe * P[v]!);
      }
    }
    return out;
  });
}

/** Probabilité approchée qu'un pion soit pris avant le prochain tour de son camp. */
export function fastRisk(state: LudoState, reach: Float64Array[], seat: number, progress: number): number {
  const home = state.seats[seat]!.home;
  const sq = absoluteSquare(state.config, home, progress);
  if (sq === null || isSafeSquare(state.config, sq)) return 0;
  let safe = 1;
  const camp = campOf(state, seat);
  state.seats.forEach((_, o) => {
    if (campOf(state, o) === camp) return;
    safe *= 1 - reach[o]![sq]!;
  });
  return 1 - safe;
}

/** Valeur des pions de chaque siège, perte attendue déduite. */
export function seatValues(state: LudoState, w: EvalWeights = DEFAULT_WEIGHTS, reach: Float64Array[] = reachMap(state)): number[] {
  return state.tokens.map((list, seat) => {
    if (state.seats[seat]!.status === 'out') return 0;
    let v = 0;
    for (const p of list) {
      const tv = tokenValue(state, p, w);
      v += tv - w.risk * fastRisk(state, reach, seat, p) * tv;
    }
    return v;
  });
}

/** Valeur d'un camp (pions du partenaire pondérés). */
function campValue(state: LudoState, values: number[], seat: number, w: EvalWeights): number {
  const camp = campOf(state, seat);
  let v = 0;
  values.forEach((x, s) => {
    if (campOf(state, s) === camp) v += s === seat ? x : w.partner * x;
  });
  return v;
}

const TERMINAL = 12;

/**
 * Utilité de chaque siège : valeur de son camp moins celle des camps adverses
 * (mélange de la moyenne et du plus fort). Partie finie : selon la place du camp.
 */
export function utilities(state: LudoState, w: EvalWeights = DEFAULT_WEIGHTS): number[] {
  const n = state.seats.length;
  if (state.phase === 'over') {
    const camps = campsOf(state);
    // Place d'un camp : la meilleure place de ses joueurs (équipes : la somme des places, la plus petite devant).
    const place = new Map<number, number>();
    const score = new Map<number, number>();
    state.ranking.forEach((seat, i) => {
      const c = campOf(state, seat);
      score.set(c, (score.get(c) ?? 0) + i + 1);
    });
    [...camps].sort((a, b) => (score.get(a) ?? 99) - (score.get(b) ?? 99)).forEach((c, i) => place.set(c, i));
    const k = Math.max(1, camps.length - 1);
    return Array.from({ length: n }, (_, s) => TERMINAL * (1 - (2 * place.get(campOf(state, s))!) / k));
  }
  const values = seatValues(state, w);
  const campVals = new Map<number, number>();
  for (let s = 0; s < n; s++) {
    const c = campOf(state, s);
    if (!campVals.has(c)) campVals.set(c, campValue(state, values, s, w));
  }
  return Array.from({ length: n }, (_, s) => {
    const mine = campValue(state, values, s, w);
    const others = [...campVals.entries()].filter(([c]) => c !== campOf(state, s)).map(([, v]) => v);
    if (others.length === 0) return mine;
    const mean = others.reduce((a, b) => a + b, 0) / others.length;
    const max = Math.max(...others);
    return mine - (w.oppMax * max + (1 - w.oppMax) * mean);
  });
}

/** Utilité ramenée dans ]0, 1[ (sigmoïde), pour les moyennes du MCTS. */
export function squash(u: number): number {
  return 1 / (1 + Math.exp(-u / 2));
}
