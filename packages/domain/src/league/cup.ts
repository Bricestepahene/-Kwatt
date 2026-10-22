/**
 * Coupe (écrans 28 et 30, planche RegleCompet) : poules, qualifiés, phase
 * finale aller-retour, manche décisive de 5 minutes en cas d'égalité.
 *
 * - Poules jouées en tous contre tous (V 3 · N 1 · D 0), classées avec les
 *   critères de départage des ligues ; pour une place qualificative, la manche
 *   décisive remplace le tirage au sort.
 * - Phase finale : 1er d'une poule contre 2e de la poule voisine (A1–B2,
 *   B1–A2), aller-retour. Score d'une partie de dames : victoire 2, nulle 1
 *   (Coupe des Cousins : 1–1 après une nulle, 2–0 après une victoire).
 * - Égalité sur l'ensemble des deux matchs : manche décisive de 5 minutes sur
 *   la planche de l'aller.
 */
import { damesStandings, type MatchRecord, type Ranking } from './standings.js';

export const DECIDER_CLOCK_MS = 5 * 60_000;
export const GAME_WIN_SCORE = 2;
export const GAME_DRAW_SCORE = 1;

/** Répartit les joueurs en poules en serpentin (ordre reçu = ordre de tête de série ou de tirage). */
export function makeGroups(players: readonly string[], groupCount: number): string[][] {
  if (groupCount < 1 || players.length < groupCount * 2) throw new Error('Poules impossibles');
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  players.forEach((p, i) => {
    const lap = Math.floor(i / groupCount);
    const k = i % groupCount;
    groups[lap % 2 === 0 ? k : groupCount - 1 - k]!.push(p);
  });
  return groups;
}

/** Nom d'une poule : 0 → A, 1 → B… */
export function groupName(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Classement d'une poule, avec manche décisive pour les places qualificatives. */
export function groupStandings(
  players: readonly string[],
  matches: readonly MatchRecord[],
  qualifiers: number,
  options: { draw?: readonly string[]; playoffOrder?: readonly string[] } = {},
): Ranking {
  return damesStandings(players, matches, { ...options, qualifyingPlaces: qualifiers });
}

export interface Tie {
  /** Joueur qui reçoit à l'aller. */
  first: string;
  second: string;
}

/**
 * Tableau de la phase finale à partir des qualifiés de chaque poule
 * (`qualified[g]` = qualifiés de la poule g, dans l'ordre du classement).
 * Deux qualifiés par poule : A1–B2, B1–A2, C1–D2, D1–C2… Le mieux classé
 * reçoit au retour ; le moins bien classé reçoit à l'aller.
 */
export function knockoutPairs(qualified: readonly (readonly string[])[]): Tie[] {
  const ties: Tie[] = [];
  if (qualified.every((q) => q.length === 1)) {
    for (let i = 0; i + 1 < qualified.length; i += 2) ties.push({ first: qualified[i + 1]![0]!, second: qualified[i]![0]! });
    return ties;
  }
  if (!qualified.every((q) => q.length === 2) || qualified.length % 2 === 1) {
    throw new Error('Tableau prévu pour 1 ou 2 qualifiés par poule, en nombre pair de poules');
  }
  for (let g = 0; g < qualified.length; g += 2) {
    const a = qualified[g]!;
    const b = qualified[g + 1]!;
    ties.push({ first: b[1]!, second: a[0]! });
    ties.push({ first: a[1]!, second: b[0]! });
  }
  return ties;
}

/** Tour suivant : les vainqueurs des rencontres i et i + 1 se rencontrent. */
export function nextRoundPairs(winners: readonly string[]): Tie[] {
  if (winners.length % 2 === 1) throw new Error('Nombre de vainqueurs impair');
  const ties: Tie[] = [];
  for (let i = 0; i < winners.length; i += 2) ties.push({ first: winners[i]!, second: winners[i + 1]! });
  return ties;
}

export type GameResult = 'first' | 'second' | 'draw';

/** Score d'une partie, pour `first` et `second`. */
export function gameScore(result: GameResult): [number, number] {
  if (result === 'draw') return [GAME_DRAW_SCORE, GAME_DRAW_SCORE];
  return result === 'first' ? [GAME_WIN_SCORE, 0] : [0, GAME_WIN_SCORE];
}

export interface TieOutcome {
  firstScore: number;
  secondScore: number;
  /** null : égalité, une manche décisive de 5 minutes est nécessaire. */
  winner: string | null;
  deciderNeeded: boolean;
}

/** Rencontre aller-retour : somme des deux matchs, puis manche décisive si égalité. */
export function twoLegTie(tie: Tie, leg1: GameResult, leg2: GameResult | null, decider: GameResult | null = null): TieOutcome {
  const [a1, b1] = gameScore(leg1);
  const [a2, b2] = leg2 === null ? [0, 0] : gameScore(leg2);
  const firstScore = a1 + a2;
  const secondScore = b1 + b2;
  if (leg2 === null) return { firstScore, secondScore, winner: null, deciderNeeded: false };
  if (firstScore !== secondScore) {
    return { firstScore, secondScore, winner: firstScore > secondScore ? tie.first : tie.second, deciderNeeded: false };
  }
  if (decider === null || decider === 'draw') return { firstScore, secondScore, winner: null, deciderNeeded: true };
  return { firstScore, secondScore, winner: decider === 'first' ? tie.first : tie.second, deciderNeeded: true };
}
