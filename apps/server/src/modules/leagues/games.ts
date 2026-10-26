/**
 * Les ligues et les parties en ligne (contrat C3, fournisseur : équipe Parties en ligne).
 *
 * Les ligues CONSOMMENT `createGame(tx, { context: 'league', … })` et l'événement
 * `onGameFinished(listener)`. Le module des parties en ligne les branche au démarrage :
 *
 *   setLeagueGames({ createGame, onGameFinished });
 *
 * Tant qu'il ne l'a pas fait (ou dans les tests, avec une fausse table), `leagueGames()`
 * renvoie null : les joueurs peuvent entrer dans la salle, la partie démarre au premier
 * passage de la tâche des ligues une fois le service branché.
 */
import type { Transaction } from '../../db/pool.js';

export interface LeagueGameClock {
  /** Temps de base par joueur (ms) et incrément Fischer (ms). */
  initialMs: number;
  incrementMs: number;
}

export interface CreateLeagueGameInput {
  context: 'league';
  /** Variante jouée (dames10, dames8, ludo_classique…). */
  variant: string;
  /** Sièges dans l'ordre : Dames, siège 0 = blancs (celui qui reçoit). */
  seats: { userId: string }[];
  /** Ludo par équipes : sièges de chaque équipe (partenaires face à face). */
  teams?: number[][];
  /** Pendule (Dames) ; null pour le Ludo (30 s par tour, règle des parties en ligne). */
  clock: LeagueGameClock | null;
  rated: boolean;
  stake: 0;
  league: { leagueId: string; matchId: string };
  startAt?: Date;
}

export interface LeagueGameFinished {
  gameId: string;
  context: 'machine' | 'room' | 'league';
  league?: { leagueId: string; matchId: string };
  /** Place par siège (clé = numéro de siège), nulle aux Dames. */
  outcome: { places: Record<string, number>; draw: boolean; reason: string };
  seats: { seat: number; userId: string | null }[];
  /** Dames : pièces restantes des blancs − des noirs (départage) ; Ludo : pions rentrés par siège. */
  pieceDiff?: number;
  tokensHome?: Record<string, number>;
}

export interface LeagueGamesPort {
  createGame(tx: Transaction, input: CreateLeagueGameInput): Promise<{ gameId: string }>;
  onGameFinished(listener: (event: LeagueGameFinished) => Promise<void> | void): void;
}

let port: LeagueGamesPort | null = null;
const pending: ((p: LeagueGamesPort) => void)[] = [];

/** Branché par le module des parties en ligne (ou par un test). */
export function setLeagueGames(next: LeagueGamesPort | null): void {
  port = next;
  if (next) for (const fn of pending.splice(0)) fn(next);
}

export function leagueGames(): LeagueGamesPort | null {
  return port;
}

/** Exécute `fn` dès que le service des parties est branché (tout de suite s'il l'est). */
export function whenLeagueGames(fn: (p: LeagueGamesPort) => void): void {
  if (port) fn(port);
  else pending.push(fn);
}

/** Pendules des matchs de ligue : 10 min + 5 s, manche décisive 5 min sans incrément. */
export const LEAGUE_CLOCK: LeagueGameClock = { initialMs: 10 * 60_000, incrementMs: 5_000 };
export const DECIDER_CLOCK: LeagueGameClock = { initialMs: 5 * 60_000, incrementMs: 0 };
