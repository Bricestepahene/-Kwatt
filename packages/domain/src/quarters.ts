/**
 * Guerre des quartiers (écran 36, D-11).
 *
 * - Victoire classée : +3 pts au quartier.
 * - Victoire contre plus fort (force adverse supérieure avant la partie) : +5
 *   au lieu de +3.
 * - Battre un joueur d'un quartier rival (un autre quartier que le sien) :
 *   +2 en bonus.
 * - Saison = mois civil. Le quartier se change une fois par saison.
 * - Classements par quartier, ville, pays : somme des points des joueurs.
 */
import { KWATT_UTC_OFFSET_MINUTES, monthBounds, monthKey } from './time.js';

export const QUARTER_WIN_POINTS = 3;
export const QUARTER_UPSET_WIN_POINTS = 5;
export const QUARTER_RIVAL_BONUS = 2;

export interface QuarterWinInput {
  ranked: boolean;
  winnerRating: number;
  loserRating: number;
  winnerQuarter: string | null;
  loserQuarter: string | null;
  /**
   * Partie contre la machine : décision, elle ne rapporte rien au quartier
   * (la machine n'a pas de quartier, et la guerre se joue entre joueurs).
   */
  vsMachine?: boolean;
}

/**
 * Points rapportés au quartier du gagnant (0 si partie amicale, contre la
 * machine ou sans quartier). « Plus fort » = force adverse strictement
 * supérieure avant la partie (dans la variante jouée). « Quartier rival » =
 * tout autre quartier que celui du gagnant.
 */
export function quarterPoints(input: QuarterWinInput): number {
  if (!input.ranked || input.vsMachine || !input.winnerQuarter) return 0;
  const base = input.loserRating > input.winnerRating ? QUARTER_UPSET_WIN_POINTS : QUARTER_WIN_POINTS;
  const rival = input.loserQuarter !== null && input.loserQuarter !== input.winnerQuarter;
  return base + (rival ? QUARTER_RIVAL_BONUS : 0);
}

/**
 * Ludo à n joueurs : seul le 1er gagne pour son quartier. +5 s'il a battu un
 * joueur plus fort que lui, sinon +3 ; +2 (une fois) si au moins un des
 * battus vient d'un quartier rival. Les partenaires d'équipe ne comptent pas
 * comme battus.
 */
export function quarterPointsMulti(input: {
  ranked: boolean;
  winnerRating: number;
  winnerQuarter: string | null;
  beaten: readonly { rating: number; quarter: string | null }[];
}): number {
  if (!input.ranked || !input.winnerQuarter || input.beaten.length === 0) return 0;
  const upset = input.beaten.some((b) => b.rating > input.winnerRating);
  const rival = input.beaten.some((b) => b.quarter !== null && b.quarter !== input.winnerQuarter);
  return (upset ? QUARTER_UPSET_WIN_POINTS : QUARTER_WIN_POINTS) + (rival ? QUARTER_RIVAL_BONUS : 0);
}

/**
 * Quartier champion de la saison (son cadre de profil va à tous ses joueurs) :
 * le premier du classement, s'il a marqué des points.
 */
export function seasonChampion(entries: readonly { id: string; points: number; players: number }[]): string | null {
  const top = rankQuarters(entries)[0];
  return top && top.points > 0 ? top.id : null;
}

/** Saison d'un instant : « AAAA-MM ». */
export function seasonKey(at: number, offsetMinutes = KWATT_UTC_OFFSET_MINUTES): string {
  return monthKey(at, offsetMinutes);
}

/** Numéro de saison (« Saison 3 ») à partir de la première saison. */
export function seasonNumber(key: string, firstSeasonKey: string): number {
  const toIndex = (k: string): number => {
    const m = /^(\d{4})-(\d{2})$/.exec(k);
    if (!m) throw new Error(`Saison invalide : ${k}`);
    return Number(m[1]) * 12 + Number(m[2]) - 1;
  };
  return toIndex(key) - toIndex(firstSeasonKey) + 1;
}

/** Jours restants dans la saison (« encore 9 jours »), jour courant compris. */
export function seasonDaysLeft(at: number, offsetMinutes = KWATT_UTC_OFFSET_MINUTES): number {
  const { end } = monthBounds(seasonKey(at, offsetMinutes), offsetMinutes);
  return Math.ceil((end - at) / 86_400_000);
}

/** Changement de quartier : une fois par saison. */
export function canChangeQuarter(lastChangeAt: number | null, now: number, offsetMinutes = KWATT_UTC_OFFSET_MINUTES): boolean {
  return lastChangeAt === null || seasonKey(lastChangeAt, offsetMinutes) !== seasonKey(now, offsetMinutes);
}

export interface QuarterScore {
  id: string;
  points: number;
  players: number;
  position: number;
}

/** Classement des quartiers (ou villes, ou pays) par points ; à égalité, ordre alphabétique de l'identifiant. */
export function rankQuarters(entries: readonly { id: string; points: number; players: number }[]): QuarterScore[] {
  return [...entries]
    .sort((a, b) => b.points - a.points || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e, i) => ({ ...e, position: i + 1 }));
}
