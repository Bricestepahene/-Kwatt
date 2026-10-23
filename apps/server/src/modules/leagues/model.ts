/**
 * Ligues : lignes de la base, lecture, et passage vers les types de @kwatt/domain
 * (rencontres, tables de Ludo, classements).
 */
import {
  damesStandings,
  ludoStandings,
  type BoardRules,
  type MatchOutcome,
  type MatchRecord,
  type LudoTableResult,
  type Ranking,
  type RankId,
} from '@kwatt/domain';
import type { LeagueBoard } from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

export type LeagueStatus = 'registration' | 'awaiting_validation' | 'running' | 'finished' | 'cancelled';

export interface LeagueRow {
  id: string;
  code: string;
  name: string;
  game: 'dames' | 'ludo';
  access: 'private' | 'public';
  format: 'championship' | 'cup';
  creator_id: string;
  status: LeagueStatus;
  max_places: number;
  entry: number;
  caution: number;
  min_rank: RankId | null;
  double_round: boolean;
  groups: number | null;
  qualifiers_per_group: number | null;
  rounds: number | null;
  relegated: number;
  board_rules: BoardRules & { allowed: LeagueBoard[]; defaultBoard: LeagueBoard };
  default_time: string;
  rhythm: 'daily' | 'weekly';
  first_day: string;
  registration_closes_at: Date | null;
  closed_at: Date | null;
  validated_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  draw_seed: string | null;
  bonus: number;
  created_at: Date;
}

export interface MemberRow {
  user_id: string;
  status: 'active' | 'excluded' | 'left' | 'removed';
  seq: number;
  joined_at: Date;
  entry_paid: number;
  fines_paid: number;
  refunded: number;
  draw_order: number | null;
  group_index: number | null;
  excluded_at: Date | null;
  pseudo: string;
}

export type MatchStage = 'league' | 'group' | 'knockout' | 'decider';
export type MatchStatus = 'scheduled' | 'playing' | 'played' | 'annulled' | 'cancelled';

export interface LudoSeatResult {
  playerId: string;
  /** null : absent (forfait). */
  place: number | null;
  tokensHome: number;
}

export interface MatchRow {
  id: string;
  league_id: string;
  stage: MatchStage;
  round: number;
  group_index: number | null;
  tie_index: number | null;
  leg: number | null;
  level: number | null;
  players: string[];
  day: string;
  match_at: Date;
  time_agreed: boolean;
  time_proposals: Record<string, string>;
  board: LeagueBoard | null;
  board_choices: Record<string, { board: LeagueBoard; at: string }>;
  arrivals: Record<string, string>;
  status: MatchStatus;
  outcome: MatchOutcome | null;
  piece_diff: number | null;
  results: LudoSeatResult[] | null;
  game_id: string | null;
  reminders: string[];
  played_at: Date | null;
}

const LEAGUE_COLUMNS = `id, code, name, game, access, format, creator_id, status, max_places, entry, caution, min_rank,
  double_round, groups, qualifiers_per_group, rounds, relegated, board_rules, default_time, rhythm,
  to_char(first_day, 'YYYY-MM-DD') AS first_day, registration_closes_at, closed_at, validated_at, started_at,
  finished_at, cancelled_at, cancel_reason, draw_seed, bonus, created_at`;

const MATCH_COLUMNS = `id, league_id, stage, round, group_index, tie_index, leg, level, players::text[] AS players,
  to_char(day, 'YYYY-MM-DD') AS day, match_at, time_agreed, time_proposals, board, board_choices, arrivals, status,
  outcome, piece_diff, results, game_id, reminders, played_at`;

export async function findLeague(db: Sql, id: string, lock = false): Promise<LeagueRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db.query<LeagueRow>(`SELECT ${LEAGUE_COLUMNS} FROM leagues WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return r.rows[0] ?? null;
}

export async function getLeague(db: Sql, id: string, lock = false): Promise<LeagueRow> {
  const l = await findLeague(db, id, lock);
  if (!l) throw new AppError('league.not_found', 404);
  return l;
}

export async function leagueIdByCode(db: Sql, code: string): Promise<string> {
  const r = await db.query<{ id: string }>('SELECT id FROM leagues WHERE code = $1', [code.toUpperCase()]);
  const id = r.rows[0]?.id;
  if (!id) throw new AppError('league.not_found', 404);
  return id;
}

/** Membres de la ligue (inscrits encore là, et exclus), dans l'ordre d'inscription. */
export async function loadMembers(db: Sql, leagueId: string, all = false): Promise<MemberRow[]> {
  const r = await db.query<MemberRow>(
    `SELECT m.user_id, m.status, m.seq, m.joined_at, m.entry_paid, m.fines_paid, m.refunded, m.draw_order, m.group_index, m.excluded_at,
            COALESCE(p.pseudo::text, u.display_name, '?') AS pseudo
       FROM league_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN profiles p ON p.user_id = m.user_id
      WHERE m.league_id = $1 ${all ? '' : "AND m.status IN ('active','excluded')"}
      ORDER BY m.seq`,
    [leagueId],
  );
  return r.rows;
}

export async function loadMatches(db: Sql, leagueId: string): Promise<MatchRow[]> {
  const r = await db.query<MatchRow>(`SELECT ${MATCH_COLUMNS} FROM league_matches WHERE league_id = $1 ORDER BY round, stage, tie_index NULLS FIRST, leg NULLS FIRST, id`, [
    leagueId,
  ]);
  return r.rows;
}

export async function getMatch(db: Sql, leagueId: string, matchId: string, lock = false): Promise<MatchRow> {
  if (!/^[0-9a-f-]{36}$/i.test(matchId)) throw new AppError('league.match_not_found', 404);
  const r = await db.query<MatchRow>(`SELECT ${MATCH_COLUMNS} FROM league_matches WHERE id = $1 AND league_id = $2${lock ? ' FOR UPDATE' : ''}`, [
    matchId,
    leagueId,
  ]);
  const m = r.rows[0];
  if (!m) throw new AppError('league.match_not_found', 404);
  return m;
}

export async function matchesByIds(db: Sql, ids: readonly string[]): Promise<MatchRow[]> {
  if (ids.length === 0) return [];
  const r = await db.query<MatchRow>(`SELECT ${MATCH_COLUMNS} FROM league_matches WHERE id = ANY($1::uuid[])`, [ids]);
  return r.rows;
}

export async function pseudosOf(db: Sql, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const r = await db.query<{ id: string; pseudo: string }>(
    `SELECT u.id, COALESCE(p.pseudo::text, u.display_name, '?') AS pseudo
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ANY($1::uuid[])`,
    [unique],
  );
  return new Map(r.rows.map((x) => [x.id, x.pseudo]));
}

/* ------------------------------------------------------------------ */
/* Vers @kwatt/domain                                                   */

/** Rencontre de Dames qui a un résultat (forfaits et victoires attribuées compris). */
export function toRecord(m: MatchRow): MatchRecord | null {
  if (m.status !== 'played' || !m.outcome || m.players.length !== 2) return null;
  return {
    round: m.round,
    home: m.players[0]!,
    away: m.players[1]!,
    outcome: m.outcome,
    ...(m.piece_diff !== null ? { pieceDiff: m.piece_diff } : {}),
  };
}

export function damesRecords(matches: readonly MatchRow[], stage: MatchStage = 'league', group: number | null = null): MatchRecord[] {
  const out: MatchRecord[] = [];
  for (const m of matches) {
    if (m.stage !== stage || (group !== null && m.group_index !== group)) continue;
    const r = toRecord(m);
    if (r) out.push(r);
  }
  return out;
}

/** Tables de Ludo jouées : seulement les joueurs assis (les absents ne marquent rien). */
export function ludoTables(matches: readonly MatchRow[]): LudoTableResult[] {
  const out: LudoTableResult[] = [];
  for (const m of matches) {
    if (m.status !== 'played' || !m.results) continue;
    const seated = m.results.filter((r): r is LudoSeatResult & { place: number } => r.place !== null);
    if (seated.length === 0) continue;
    const seats = seated.map((s) => ({ playerId: s.playerId, place: s.place, tokensHome: s.tokensHome }));
    // Seul présent à sa table : il la gagne comme une table de deux (siège fantôme, ignoré du classement).
    if (seats.length === 1) seats.push({ playerId: '', place: 2, tokensHome: 0 });
    out.push({ round: m.round, seats });
  }
  return out;
}

/**
 * Rencontres « vues pour les absences » : pour chaque joueur, ses matchs dans l'ordre, forfait
 * ou non. Au Ludo, une table où il était absent compte comme un forfait.
 */
export function attendanceRecords(matches: readonly MatchRow[]): MatchRecord[] {
  const out: MatchRecord[] = [];
  for (const m of matches) {
    if (m.status !== 'played') continue;
    if (m.results) {
      for (const r of m.results) {
        out.push({ round: m.round, home: r.playerId, away: '', outcome: r.place === null ? 'home_forfeit' : 'home_win' });
      }
    } else {
      const rec = toRecord(m);
      if (rec) out.push(rec);
    }
  }
  return out;
}

/** Forfaits de chacun (double forfait : un pour chacun). */
export function forfeitCounts(matches: readonly MatchRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rec of attendanceRecords(matches)) {
    const who =
      rec.outcome === 'home_forfeit' ? [rec.home] : rec.outcome === 'away_forfeit' ? [rec.away] : rec.outcome === 'double_forfeit' ? [rec.home, rec.away] : [];
    for (const id of who) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Ordre du tirage au sort (critère 5 du départage). */
export function drawOrder(members: readonly MemberRow[]): string[] {
  return [...members].filter((m) => m.draw_order !== null).sort((a, b) => a.draw_order! - b.draw_order!).map((m) => m.user_id);
}

/** Classement du championnat (Dames ou Ludo), à partir des rencontres jouées. */
export function championshipRanking(league: Pick<LeagueRow, 'game'>, members: readonly MemberRow[], matches: readonly MatchRow[]): Ranking {
  const ids = members.map((m) => m.user_id);
  const draw = drawOrder(members);
  if (league.game === 'ludo') {
    const ranking = ludoStandings(ids, ludoTables(matches), { draw });
    // Les forfaits ne marquent pas de points au Ludo ; on les compte pour l'affichage.
    const forfeits = forfeitCounts(matches);
    for (const row of ranking.rows) row.forfeits = forfeits.get(row.playerId) ?? 0;
    return ranking;
  }
  return damesStandings(ids, damesRecords(matches), { draw });
}
