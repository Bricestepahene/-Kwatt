/**
 * Ligues : calculs purs des écrans 27 à 35 (aperçus de création, libellés, minuteries).
 * Le serveur fait foi : ces calculs ne servent qu'à l'affichage avant envoi.
 */
import {
  dayKey,
  leagueCaution,
  leagueMinimumPlayers,
  leaguePot,
  POT_SHARES,
  PUBLIC_LEAGUE_ENTRY,
  PUBLIC_LEAGUE_PLACES,
} from '@kwatt/domain';
import type { BoardPolicy, CreateLeagueRequest, LeagueBoard, LeagueGame, LeagueMatchCard, StandingRowView } from '@kwatt/protocol';
import { extractRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from '../../ui/logic';

export const DAMES_LEAGUE_BOARDS = ['dames10', 'dames8'] as const satisfies readonly LeagueBoard[];
export const LUDO_LEAGUE_BOARDS = ['ludo_classique', 'ludo_rapide', 'ludo_six', 'ludo_parchis', 'ludo_pachisi'] as const satisfies readonly LeagueBoard[];
/** Planches amicales : seulement en ligue privée (tableau « Ce qui est permis où »). */
export const FRIENDLY_BOARDS: readonly LeagueBoard[] = ['ludo_parchis', 'ludo_pachisi'];

export function boardsOf(game: LeagueGame): readonly LeagueBoard[] {
  return game === 'dames' ? DAMES_LEAGUE_BOARDS : LUDO_LEAGUE_BOARDS;
}

/** Règles de planche proposées (au Ludo, personne ne « reçoit »). */
export function policiesOf(game: LeagueGame): readonly BoardPolicy[] {
  return game === 'dames' ? ['imposed', 'home', 'rotation', 'agreement'] : ['imposed', 'rotation', 'agreement'];
}

export function isUuid(text: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
}

/** Code de ligue tapé ou collé (« K7L-IGA », lien kwatt://ligue/…), ou null s'il est incomplet. */
export function leagueCodeFrom(text: string): string | null {
  const fromLink = extractRoomCode(text);
  if (fromLink) return fromLink;
  const code = normalizeRoomCode(text);
  return code.length === ROOM_CODE_LENGTH ? code : null;
}

/* ------------------------------------------------------------------ */
/* Brouillon de création (écrans 28, 28b, 31)                           */

export type LeagueDraft = Required<Omit<CreateLeagueRequest, 'registrationClosesAt' | 'groups' | 'qualifiersPerGroup' | 'rounds'>> & {
  groups: number;
  qualifiersPerGroup: number;
  rounds: number;
  /** Fin des inscriptions (publique), jour AAAA-MM-JJ à 23:59 heure du Cameroun. */
  closesDay: string;
};

const DAY_MS = 86_400_000;

export function defaultDraft(access: 'private' | 'public', now: number, game: LeagueGame = 'dames'): LeagueDraft {
  const pub = access === 'public';
  return {
    name: '',
    game,
    access,
    format: 'championship',
    maxPlaces: pub ? PUBLIC_LEAGUE_PLACES.default : 10,
    entry: pub ? PUBLIC_LEAGUE_ENTRY.default : 0,
    minRank: null,
    doubleRound: !pub,
    groups: 2,
    qualifiersPerGroup: 2,
    rounds: 6,
    relegated: pub ? 0 : 2,
    boardRules: game === 'dames'
      ? { policy: pub ? 'imposed' : 'home', allowed: pub ? ['dames10'] : ['dames10', 'dames8'], defaultBoard: 'dames10' }
      : { policy: 'imposed', allowed: ['ludo_classique'], defaultBoard: 'ludo_classique' },
    defaultTime: pub ? '20:00' : '18:00',
    rhythm: pub ? 'daily' : 'weekly',
    // Publique : inscriptions ouvertes une semaine, premier match trois jours après.
    closesDay: dayKey(now + 7 * DAY_MS),
    firstDay: dayKey(now + (pub ? 10 : 1) * DAY_MS),
  };
}

/** Change de jeu en gardant ce qui a un sens (la planche repart sur celle par défaut du jeu). */
export function withGame(draft: LeagueDraft, game: LeagueGame): LeagueDraft {
  if (draft.game === game) return draft;
  const board: LeagueBoard = game === 'dames' ? 'dames10' : 'ludo_classique';
  return {
    ...draft,
    game,
    format: game === 'ludo' ? 'championship' : draft.format,
    boardRules: { policy: 'imposed', allowed: [board], defaultBoard: board },
  };
}

/** Change la règle de planche : « imposée » ne garde qu'une planche. */
export function withPolicy(draft: LeagueDraft, policy: BoardPolicy): LeagueDraft {
  const allowed = policy === 'imposed' ? [draft.boardRules.defaultBoard] : draft.boardRules.allowed;
  return { ...draft, boardRules: { policy, allowed, defaultBoard: draft.boardRules.defaultBoard } };
}

/** Coche ou décoche une planche (au moins une ; imposée : une seule). La première permise est celle par défaut. */
export function toggleBoard(draft: LeagueDraft, board: LeagueBoard): LeagueDraft {
  const { policy, allowed } = draft.boardRules;
  let next: LeagueBoard[];
  if (policy === 'imposed') next = [board];
  else if (allowed.includes(board)) next = allowed.filter((b) => b !== board);
  else next = boardsOf(draft.game).filter((b) => b === board || allowed.includes(b));
  if (next.length === 0) return draft;
  const defaultBoard = next.includes(draft.boardRules.defaultBoard) ? draft.boardRules.defaultBoard : next[0]!;
  return { ...draft, boardRules: { policy, allowed: next, defaultBoard } };
}

/** Planches que le brouillon peut proposer (pas d'amical en ligue publique). */
export function boardChoices(draft: Pick<LeagueDraft, 'game' | 'access'>): readonly LeagueBoard[] {
  return boardsOf(draft.game).filter((b) => draft.access === 'private' || !FRIENDLY_BOARDS.includes(b));
}

export function clampStep(value: number, min: number, max: number, step: number): number {
  const stepped = min + Math.round((value - min) / step) * step;
  return Math.min(max, Math.max(min, stepped));
}

/** Nombre de journées d'un championnat de n joueurs (aller simple ou aller-retour). */
export function championshipRounds(players: number, doubleRound: boolean): number {
  if (players < 2) return 0;
  const single = players % 2 === 0 ? players - 1 : players;
  return doubleRound ? single * 2 : single;
}

/** Nombre de matchs d'un championnat de n joueurs. */
export function championshipMatches(players: number, doubleRound: boolean): number {
  const single = (players * (players - 1)) / 2;
  return doubleRound ? single * 2 : single;
}

/** Corps de la requête POST /v1/leagues. */
export function draftRequest(draft: LeagueDraft): CreateLeagueRequest {
  const { closesDay, groups, qualifiersPerGroup, rounds, ...rest } = draft;
  return {
    ...rest,
    name: rest.name.trim(),
    ...(draft.format === 'cup' ? { groups, qualifiersPerGroup, doubleRound: false } : {}),
    ...(draft.game === 'ludo' ? { rounds } : {}),
    ...(draft.access === 'public' ? { registrationClosesAt: endOfKwattDay(closesDay) } : {}),
  };
}

/** 23:59 heure du Cameroun (UTC+1) le jour donné, en ISO. */
export function endOfKwattDay(day: string): string {
  return new Date(`${day}T22:59:00.000Z`).toISOString();
}

/** Ajoute des jours à un jour AAAA-MM-JJ. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Aujourd'hui, heure du Cameroun. */
export function kwattToday(now: number = Date.now()): string {
  return dayKey(now);
}

/** Aperçu de l'argent d'une ligue publique (écran 31) : caution, pot si complète et parts. */
export function publicPreview(maxPlaces: number, entry: number) {
  const pot = leaguePot(maxPlaces, entry);
  const share = (pct: number) => Math.floor((pot * pct) / 100);
  return {
    caution: leagueCaution(maxPlaces),
    minPlayers: leagueMinimumPlayers(maxPlaces),
    pot,
    first: share(POT_SHARES.first),
    creator: share(POT_SHARES.creator),
  };
}

/** Possibilités de poules pour n places : (poules, qualifiés) qui donnent 2, 4, 8… qualifiés. */
export function cupShapes(maxPlaces: number): { groups: number; qualifiersPerGroup: number }[] {
  const out: { groups: number; qualifiersPerGroup: number }[] = [];
  for (const groups of [1, 2, 4, 8]) {
    if (maxPlaces < groups * 2) continue;
    for (const q of [1, 2]) {
      const qualified = groups * q;
      if (qualified < 2 || (qualified & (qualified - 1)) !== 0) continue;
      if (q === 2 && groups > 1 && groups % 2 === 1) continue;
      out.push({ groups, qualifiersPerGroup: q });
    }
  }
  return out;
}

/** Tours de la phase finale pour un nombre de qualifiés (4 → demi-finales, finale). */
export function knockoutLevels(qualified: number): number {
  return Math.max(1, Math.round(Math.log2(qualified)));
}

/* ------------------------------------------------------------------ */
/* Lecture                                                              */

export type Zone = StandingRowView['zone'];

/** Libellé d'une rencontre de coupe : « final », « semi », « quarter », sinon « round ». */
export function knockoutStageKey(tiesAtLevel: number): 'final' | 'semi' | 'quarter' | 'round' {
  if (tiesAtLevel === 1) return 'final';
  if (tiesAtLevel === 2) return 'semi';
  if (tiesAtLevel === 4) return 'quarter';
  return 'round';
}

/** Lettre d'une poule (0 → A). */
export function groupLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Durée restante en heures et minutes (pour « se termine dans 9 h 12 »). */
export function hoursMinutes(ms: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.floor(ms / 60_000));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** Durée restante en jours et heures (pour « ferme dans 3 j 04 h »). */
export function daysHours(ms: number): { days: number; hours: number } {
  const total = Math.max(0, Math.floor(ms / 3_600_000));
  return { days: Math.floor(total / 24), hours: total % 24 };
}

/** L'adversaire d'un match de Dames vu par `me`. */
export function opponentOf(match: Pick<LeagueMatchCard, 'players'>, me: string | null) {
  return match.players.find((p) => p.userId !== me) ?? null;
}

/** Progression d'une barre (0 à 1). */
export function fillRatio(taken: number, max: number): number {
  return max <= 0 ? 0 : Math.min(1, Math.max(0, taken / max));
}

/** Où mène une ligue : inscriptions d'une publique (32), coupe (30), sinon le championnat (29). */
export function leagueHref(league: { id: string; code: string; access: string; status: string; format: string }): string {
  if (league.access === 'public' && (league.status === 'registration' || league.status === 'awaiting_validation')) return `/ligue-publique/${league.id}`;
  return league.format === 'cup' ? `/ligue/${league.code}/coupe` : `/ligue/${league.code}`;
}
