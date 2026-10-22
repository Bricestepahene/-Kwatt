/**
 * Écran 18 · Fin de partie, commun aux Dames et au Ludo (contrat C4) — module pur.
 *
 * Source : la partie gardée sur l'appareil (historique local), sinon le résumé du serveur
 * (`GET /v1/games/:id`, C3). Les deux sont ramenés à une même vue : qui a gagné, les cauris,
 * la force, et la suite selon le contexte (machine, défi, salon « roi de la table »,
 * aller-retour, ligue).
 */
import type { GameSummary, MachineSettlementView, RatingChangeView } from '@kwatt/protocol';
import type { GameFamily } from './controller';
import type { LocalGame } from './historyStore';

export type Verdict = 'win' | 'loss' | 'draw';

export interface ResultPlayer {
  seat: number;
  name: string;
  userId: string | null;
  machine: string | null;
  place: number;
  me: boolean;
  avatar?: unknown;
}

export type ResultNext =
  | { kind: 'machine'; variant: string }
  | { kind: 'rematch'; opponent: ResultPlayer | null; stake: number; code: string | null }
  | { kind: 'return_leg'; code: string; opponent: ResultPlayer | null; stake: number }
  | { kind: 'king'; code: string; stays: boolean; next: { userId: string; pseudo: string } | null }
  | { kind: 'same_table'; code: string }
  | { kind: 'league'; leagueId: string }
  | { kind: 'none' };

export interface ResultView {
  id: string;
  family: GameFamily;
  variant: string;
  context: 'machine' | 'room' | 'league';
  verdict: Verdict;
  /** Ta place (1 = premier) ; Dames : 1 ou 2, nulle : 1. */
  myPlace: number;
  playerCount: number;
  players: ResultPlayer[];
  /** Adversaire principal (Dames) : l'autre joueur. */
  opponent: ResultPlayer | null;
  me: ResultPlayer | null;
  reason: string;
  /** Coups joués (Dames : coups complets ; Ludo : tours). */
  moveCount: number;
  stake: number;
  pot: number;
  settlement: MachineSettlementView | null;
  /** Cauris : ta variation, et celle de l'adversaire (défi) ; null si inconnue. */
  myCauris: number | null;
  opponentCauris: number | null;
  rating: RatingChangeView | null;
  /** Résultat contre la machine encore en attente du réseau. */
  pending: boolean;
  /** Code d'erreur si le serveur a refusé le résultat. */
  rejected: string | null;
  difficulty: string | null;
  winStreak: number | null;
  card: string | null;
  next: ResultNext;
}

const placeOf = (places: Record<string | number, number>, seat: number, fallback: number): number => {
  const v = places[seat] ?? places[String(seat)];
  return typeof v === 'number' ? v : fallback;
};

function verdictOf(myPlace: number, places: number[], draw: boolean): Verdict {
  if (draw || places.every((p) => p === myPlace)) return 'draw';
  return myPlace === 1 ? 'win' : 'loss';
}

/** Coups « complets » aux Dames (46 coups = 92 demi-coups), tours au Ludo. */
function countMoves(family: GameFamily, moves: readonly string[]): number {
  return family === 'dames' ? Math.ceil(moves.length / 2) : moves.length;
}

export function fromLocalGame(game: LocalGame): ResultView {
  const mine = new Set(game.mySeats ?? [0]);
  const places = game.seats.map((s) => placeOf(game.outcome.places, s.seat, game.seats.length));
  const players: ResultPlayer[] = game.seats.map((s, i) => ({
    seat: s.seat,
    name: s.name,
    userId: s.userId,
    machine: s.machine?.difficulty ?? null,
    place: places[i]!,
    me: mine.has(s.seat),
    ...(s.avatar !== undefined ? { avatar: s.avatar } : {}),
  }));
  const me = players.find((p) => p.me) ?? null;
  const myPlace = me?.place ?? players.length;
  const opponent = players.find((p) => !p.me) ?? null;
  const settlement = game.settlement ?? null;
  const verdict = verdictOf(myPlace, places, game.outcome.draw);
  const context = game.context ?? 'machine';
  return {
    id: game.id,
    family: game.family,
    variant: game.variant,
    context,
    verdict,
    myPlace,
    playerCount: players.length,
    players: [...players].sort((a, b) => a.place - b.place || a.seat - b.seat),
    opponent,
    me,
    reason: game.outcome.reason,
    moveCount: countMoves(game.family, game.moves),
    stake: game.machine?.bet ?? 0,
    pot: 0,
    settlement,
    myCauris: settlement ? settlement.net : null,
    opponentCauris: null,
    rating: game.rating ?? null,
    pending: Boolean(game.machine?.pending),
    rejected: game.machine?.rejected ?? null,
    difficulty: game.machine?.difficulty ?? null,
    winStreak: game.machine?.winStreak ?? null,
    card: game.card ?? null,
    next: context === 'machine' ? { kind: 'machine', variant: game.variant } : { kind: 'none' },
  };
}

export function fromSummary(game: GameSummary, myUserId: string | null): ResultView {
  const outcome = game.outcome;
  const n = game.seats.length;
  const places = game.seats.map((s) => (outcome ? placeOf(outcome.places, s.seat, n) : n));
  const players: ResultPlayer[] = game.seats.map((s, i) => ({
    seat: s.seat,
    name: s.pseudo,
    userId: s.userId,
    machine: s.machine?.difficulty ?? null,
    place: places[i]!,
    me: myUserId !== null && s.userId === myUserId,
    ...(s.avatar ? { avatar: s.avatar } : {}),
  }));
  const me = players.find((p) => p.me) ?? null;
  const spectator = me === null;
  const myPlace = me?.place ?? 1;
  const opponent = players.find((p) => !p.me) ?? null;
  const draw = outcome?.draw ?? false;
  const verdict: Verdict = spectator ? (draw ? 'draw' : 'win') : verdictOf(myPlace, places, draw);
  const rating = (myUserId && game.ratingChanges[myUserId]) || null;
  const stake = game.stake;
  const winners = players.filter((p) => p.place === 1).length || 1;

  // Cauris d'une partie avec mise : le gagnant prend le pot ; nulle (Dames) : chacun récupère sa mise.
  const caurisFor = (p: ResultPlayer | null): number | null => {
    if (!p || stake === 0) return null;
    if (draw) return 0;
    return p.place === 1 ? Math.floor(game.pot / winners) - stake : -stake;
  };
  const settlement = game.settlement ?? null;
  const myCauris = settlement ? settlement.net : caurisFor(me);

  let next: ResultNext = { kind: 'none' };
  if (game.context === 'machine') next = { kind: 'machine', variant: game.variant };
  else if (game.context === 'league' && game.league) next = { kind: 'league', leagueId: game.league.leagueId };
  else if (game.room?.format === 'roi') {
    next = { kind: 'king', code: game.room.code, stays: myPlace === 1 && !draw, next: game.room.nextChallenger ?? null };
  } else if (game.room?.format === 'aller_retour' && game.room.leg === 1) {
    next = { kind: 'return_leg', code: game.room.code, opponent, stake };
  } else if (game.family === 'ludo' && game.room) {
    next = { kind: 'same_table', code: game.room.code };
  } else if (!spectator) {
    next = { kind: 'rematch', opponent, stake, code: game.room?.code ?? null };
  }

  return {
    id: game.id,
    family: game.family,
    variant: game.variant,
    context: game.context,
    verdict,
    myPlace,
    playerCount: n,
    players: [...players].sort((a, b) => a.place - b.place || a.seat - b.seat),
    opponent,
    me,
    reason: outcome?.reason ?? '',
    moveCount: countMoves(game.family, game.moves),
    stake,
    pot: game.pot,
    settlement,
    myCauris,
    opponentCauris: caurisFor(opponent),
    rating,
    pending: false,
    rejected: null,
    difficulty: players.find((p) => p.machine)?.machine ?? null,
    winStreak: null,
    card: null,
    next,
  };
}

/** Plus grande rafle d'un camp (« 3 prises d'un coup »), à partir des coups en notation officielle. */
export function longestCapture(moves: readonly string[], ownPlies: 'even' | 'odd'): number {
  let best = 0;
  moves.forEach((m, i) => {
    if ((i % 2 === 0) !== (ownPlies === 'even')) return;
    if (m.includes('x')) best = Math.max(best, m.split('x').length - 1);
  });
  return best;
}
