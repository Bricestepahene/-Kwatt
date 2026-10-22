/**
 * Probabilité exacte d'être pris avant son prochain tour.
 *
 * Pour chaque adversaire qui joue avant notre prochain tour, on parcourt tous
 * ses lancers possibles avec leur probabilité exacte (dé : 1/6 chacun ;
 * cauris : loi binomiale), y compris les lancers de plus (6, grâce, capture qui
 * rejoue) et les coups bonus (+ 20, + 10), avec les vraies règles
 * (`@kwatt/rules-ludo` : barrières, cases protégées, sortie qui prend…).
 * Un pion est « pris » si l'adversaire a au moins une suite de coups qui le
 * prend : on suppose qu'il la jouerait.
 *
 * Approximation assumée : chaque adversaire est évalué sur la position
 * actuelle (sans les coups des autres adversaires avant lui), et les
 * adversaires sont supposés indépendants.
 */
import {
  absoluteSquare,
  applyLegalMove,
  applyRoll,
  arePartners,
  controlledSeats,
  legalMoves,
  throwDistribution,
  type LudoState,
} from '@kwatt/rules-ludo';

export interface ThreatReport {
  /** perToken[siège][pion] : probabilité que ce pion soit pris avant le prochain tour du camp (0 si non visé). */
  perToken: number[][];
  /** Probabilité qu'au moins un pion du camp soit pris. */
  any: number;
  /** Nœuds visités (coût du calcul). */
  nodes: number;
}

/** Profondeur maximale en lancers d'un même adversaire (trois 6 au plus). */
const MAX_THROWS = 3;

interface Search {
  targets: { seat: number; token: number }[];
  nodes: number;
}

/** Position où c'est à `seat` de lancer, le reste inchangé. */
export function turnOf(state: LudoState, seat: number): LudoState {
  return { ...state, current: seat, phase: 'roll', roll: null, sixesInRow: 0, bonus: [], extraRoll: false, lastMoved: null };
}

/**
 * Probabilités (une par cible, puis « au moins une ») que `opp` puisse prendre
 * la cible pendant son tour, à partir de `state` (phase 'roll', au trait).
 */
function chance(state: LudoState, opp: number, search: Search, throws: number): number[] {
  const k = search.targets.length;
  const acc = new Array<number>(k + 1).fill(0);
  if (throws <= 0) return acc;
  for (const { value, p } of throwDistribution(state.config.mechanics.throw)) {
    search.nodes++;
    const s1 = applyRoll(state, value);
    const r = continuation(s1, opp, search, throws - 1);
    for (let i = 0; i <= k; i++) acc[i]! += p * r[i]!;
  }
  return acc;
}

/** Après un lancer ou un coup : décision de l'adversaire, nouveau lancer, ou fin de son tour. */
function continuation(state: LudoState, opp: number, search: Search, throws: number): number[] {
  const k = search.targets.length;
  if (state.phase === 'over' || state.current !== opp) return new Array<number>(k + 1).fill(0);
  if (state.phase === 'roll') return chance(state, opp, search, throws);
  return decision(state, opp, search, throws);
}

function decision(state: LudoState, opp: number, search: Search, throws: number): number[] {
  const k = search.targets.length;
  const best = new Array<number>(k + 1).fill(0);
  for (const m of legalMoves(state)) {
    search.nodes++;
    const hits = search.targets.map((t) => m.captures.some((c) => c.seat === t.seat && c.token === t.token));
    const anyHit = hits.some(Boolean);
    // Une prise tout de suite : certitude pour cette cible (et pour « au moins une »).
    let rest: number[] | null = null;
    for (let i = 0; i < k; i++) {
      if (hits[i]) best[i] = 1;
      else if (best[i]! < 1) {
        rest ??= continuation(applyLegalMove(state, m), opp, search, throws);
        best[i] = Math.max(best[i]!, rest[i]!);
      }
    }
    if (anyHit) best[k] = 1;
    else if (best[k]! < 1) {
      rest ??= continuation(applyLegalMove(state, m), opp, search, throws);
      best[k] = Math.max(best[k]!, rest[k]!);
    }
  }
  return best;
}

/**
 * Menaces sur le camp de `seat` (lui et ses partenaires) de la part des
 * adversaires qui jouent avant le prochain tour de `seat`.
 */
export function threatsTo(state: LudoState, seat: number): ThreatReport {
  const n = state.seats.length;
  const perToken = state.tokens.map((list) => list.map(() => 0));
  const targets: { seat: number; token: number }[] = [];
  state.tokens.forEach((list, s) => {
    if (!arePartners(state, seat, s) || state.seats[s]!.status === 'out') return;
    // Seuls les pions sur la piste commune peuvent être pris.
    list.forEach((p, token) => {
      if (absoluteSquare(state.config, state.seats[s]!.home, p) !== null) targets.push({ seat: s, token });
    });
  });
  const search: Search = { targets, nodes: 0 };
  if (state.phase === 'over' || targets.length === 0) return { perToken, any: 0, nodes: 0 };
  // Adversaires dans l'ordre du jeu, jusqu'au retour de `seat`.
  const safe = targets.map(() => 1);
  let safeAny = 1;
  for (let i = 1; i < n; i++) {
    const opp = (seat + i) % n;
    if (arePartners(state, seat, opp)) continue;
    // Un adversaire qui a tout rentré peut encore jouer les pions de son partenaire.
    if (controlledSeats(state, opp).length === 0) continue;
    const r = chance(turnOf(state, opp), opp, search, MAX_THROWS);
    targets.forEach((_, j) => {
      safe[j]! *= 1 - r[j]!;
    });
    safeAny *= 1 - r[targets.length]!;
  }
  targets.forEach((t, j) => {
    perToken[t.seat]![t.token] = 1 - safe[j]!;
  });
  return { perToken, any: 1 - safeAny, nodes: search.nodes };
}
