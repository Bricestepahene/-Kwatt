/**
 * Ligues par équipes (planche RegleCompet, « Matchs par équipes ») : championnat privé,
 * Dames en équipes de 3, Ludo en équipes de 2.
 *
 * - On s'inscrit en créant une équipe (on en devient capitaine) ou en rejoignant une équipe
 *   qui n'est pas complète ; chacun paie son entrée.
 * - Au lancement, les équipes incomplètes sont dissoutes (entrées rendues) ; le tirage au sort
 *   ordonne les équipes, la méthode du cercle donne les rencontres.
 * - Dames : une rencontre = 3 parties à la même heure ; chaque capitaine dépose l'ordre de ses
 *   joueurs jusqu'à 1 h avant (sinon l'ordre d'arrivée dans l'équipe), puis il est figé et
 *   appliqué aux planches (l'équipe qui reçoit a les blancs sur les planches 1 et 3).
 * - Ludo : une rencontre = une table de 4, partenaires face à face.
 * - Classement par équipe ; la cagnotte va à l'équipe championne (parts égales, le reste au
 *   capitaine) ; médailles pour les joueurs des trois premières équipes.
 *
 * Toute la logique chiffrée vient de @kwatt/domain (league/teams.ts).
 */
import { randomBytes } from 'node:crypto';
import {
  damesTeamMatch,
  effectiveLineup,
  lineupEditable,
  ludoTeamMatch,
  roundRobin,
  splitTeamPot,
  teamBoards,
  teamStandings,
  LINEUP_DEADLINE_MS,
  type BoardResult,
  type TeamMatchRecord,
  type TeamMatchScore,
  type TeamStandingRow,
} from '@kwatt/domain';
import type { CreateLeagueBody } from '@kwatt/protocol';
import { transaction, type Sql, type Transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { grantItem } from '../shop/catalog.js';
import { getLeague, loadMatches, loadMembers, pseudosOf, type LeagueRow, type MatchRow, type MemberRow } from './model.js';
import { payOut, potOf, refundFromPot, returnCaution } from './money.js';
import { dayOfRound, drawPlayers, effectiveFirstDay, matchAtOf } from './schedule.js';
import { addMember, joinRefusal, TROPHY_CARD, type Actor, type LeagueDeps } from './service.js';

/** Équipes de 2 à 16 dans une ligue (maxPlaces compte les équipes). */
export const MAX_TEAMS = 16;
/** Table de Ludo par équipes : partenaires face à face (sièges 0 et 2, 1 et 3). */
export const LUDO_TEAM_SEATS = [
  [0, 2],
  [1, 3],
];

export interface TeamRow {
  id: string;
  league_id: string;
  name: string;
  captain_id: string;
  draw_order: number | null;
  created_at: Date;
}

export interface TeamMatchRow {
  id: string;
  league_id: string;
  round: number;
  home_team: string;
  away_team: string;
  match_at: Date;
  lineups: Record<string, string[]>;
  lineup_locked: boolean;
}

/* ------------------------------------------------------------------ */
/* Lecture                                                              */

export async function loadTeams(db: Sql, leagueId: string): Promise<TeamRow[]> {
  const r = await db.query<TeamRow>(
    `SELECT id, league_id, name, captain_id, draw_order, created_at FROM league_teams WHERE league_id = $1 ORDER BY draw_order NULLS LAST, created_at, id`,
    [leagueId],
  );
  return r.rows;
}

export async function loadTeamMatches(db: Sql, leagueId: string): Promise<TeamMatchRow[]> {
  const r = await db.query<TeamMatchRow>(
    `SELECT id, league_id, round, home_team, away_team, match_at, lineups, lineup_locked FROM league_team_matches WHERE league_id = $1 ORDER BY round, id`,
    [leagueId],
  );
  return r.rows;
}

/** Joueurs actifs d'une équipe : le capitaine d'abord, puis l'ordre d'arrivée. */
export function rosterOf(team: Pick<TeamRow, 'id' | 'captain_id'>, members: readonly MemberRow[]): string[] {
  const mine = members.filter((m) => m.team_id === team.id && m.status === 'active').sort((a, b) => a.seq - b.seq);
  return [...mine.filter((m) => m.user_id === team.captain_id), ...mine.filter((m) => m.user_id !== team.captain_id)].map((m) => m.user_id);
}

/** Places encore libres : peut-on créer une équipe, en rejoindre une ? */
export async function teamCapacity(db: Sql, league: LeagueRow): Promise<{ canCreate: boolean; canJoin: boolean }> {
  const teams = await loadTeams(db, league.id);
  const members = await loadMembers(db, league.id);
  const size = league.team_size ?? 0;
  return {
    canCreate: teams.length < league.max_places,
    canJoin: teams.some((t) => rosterOf(t, members).length < size),
  };
}

/* ------------------------------------------------------------------ */
/* Création et inscriptions                                             */

/** Réglages d'une ligue par équipes (création). */
export function checkTeamSettings(body: CreateLeagueBody): void {
  if (body.teamSize === null) return;
  const invalid = (reason: string) => new AppError('league.settings_invalid', 400, { reason });
  if (body.access !== 'private' || body.format !== 'championship') throw invalid('teams_private_championship');
  if (body.teamSize !== (body.game === 'dames' ? 3 : 2)) throw invalid('team_size');
  if (body.maxPlaces > MAX_TEAMS) throw invalid('teams_too_many');
  if (!body.teamName) throw invalid('team_name');
  // Une rencontre d'équipes se joue à une seule heure, sur une planche connue de tous.
  if (body.boardRules.policy !== 'imposed' && body.boardRules.policy !== 'rotation') throw invalid('team_board_policy');
  // Ludo : partenaires face à face, donc une table de 4.
  if (body.game === 'ludo' && body.boardRules.allowed.includes('ludo_six')) throw invalid('team_ludo_six');
}

async function insertTeam(tx: Transaction, league: LeagueRow, name: string, captainId: string, now: Date): Promise<string> {
  const taken = await tx.query('SELECT 1 FROM league_teams WHERE league_id = $1 AND lower(name) = lower($2)', [league.id, name]);
  if (taken.rowCount) throw new AppError('league.team_name_taken', 409);
  const r = await tx.query<{ id: string }>(`INSERT INTO league_teams (league_id, name, captain_id, created_at) VALUES ($1, $2, $3, $4) RETURNING id`, [
    league.id,
    name,
    captainId,
    now,
  ]);
  return r.rows[0]!.id;
}

/** Le créateur d'une ligue privée par équipes joue : il crée son équipe en même temps. */
export async function createCreatorTeam(tx: Transaction, league: LeagueRow, name: string, now: Date): Promise<void> {
  const teamId = await insertTeam(tx, league, name, league.creator_id, now);
  await addMember(tx, league, league.creator_id, now, teamId);
}

async function assertCanJoin(tx: Transaction, league: LeagueRow, actor: Actor): Promise<void> {
  if (!league.team_size) throw new AppError('league.wrong_status', 409, { status: league.status });
  const members = await loadMembers(tx, league.id);
  if (members.some((m) => m.user_id === actor.userId)) throw new AppError('league.already_member', 409);
  const refusal = await joinRefusal(tx, league, actor, 0);
  if (refusal) {
    const status = refusal === 'league.insufficient_balance' || refusal === 'league.full' || refusal === 'league.wrong_status' ? 409 : 403;
    throw new AppError(refusal, status, refusal === 'league.wrong_status' ? { status: league.status } : {});
  }
}

/** Créer une équipe : tu en deviens le capitaine (ton entrée est bloquée). */
export async function createTeam(deps: LeagueDeps, actor: Actor, leagueId: string, name: string): Promise<string> {
  const now = deps.clock.now();
  return transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    await assertCanJoin(tx, league, actor);
    if ((await loadTeams(tx, leagueId)).length >= league.max_places) throw new AppError('league.full', 409);
    const teamId = await insertTeam(tx, league, name, actor.userId, now);
    await addMember(tx, league, actor.userId, now, teamId);
    return teamId;
  });
}

/** Rejoindre une équipe qui n'est pas complète. */
export async function joinTeam(deps: LeagueDeps, actor: Actor, leagueId: string, teamId: string): Promise<void> {
  const now = deps.clock.now();
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    await assertCanJoin(tx, league, actor);
    const team = (await loadTeams(tx, leagueId)).find((t) => t.id === teamId);
    if (!team) throw new AppError('league.team_not_found', 404);
    if (rosterOf(team, await loadMembers(tx, leagueId)).length >= (league.team_size ?? 0)) throw new AppError('league.team_full', 409);
    await addMember(tx, league, actor.userId, now, teamId);
    await deps.notifications.notify(tx, team.captain_id, 'league.team_joined', {
      leagueId: league.id,
      leagueName: league.name,
      code: league.code,
      team: team.name,
      userId: actor.userId,
      pseudo: (await pseudosOf(tx, [actor.userId])).get(actor.userId) ?? '',
    });
  });
}

/**
 * Un joueur quitte son équipe avant le début (départ, ou retiré par le créateur) : le suivant
 * devient capitaine ; une équipe vide disparaît.
 */
export async function afterTeamMemberLeft(tx: Transaction, league: LeagueRow, userId: string): Promise<void> {
  if (!league.team_size) return;
  const r = await tx.query<{ team_id: string | null }>('SELECT team_id FROM league_members WHERE league_id = $1 AND user_id = $2', [league.id, userId]);
  const teamId = r.rows[0]?.team_id;
  if (!teamId) return;
  await tx.query('UPDATE league_members SET team_id = NULL WHERE league_id = $1 AND user_id = $2', [league.id, userId]);
  const next = await tx.query<{ user_id: string }>(
    `SELECT user_id FROM league_members WHERE league_id = $1 AND team_id = $2 AND status = 'active' ORDER BY seq LIMIT 1`,
    [league.id, teamId],
  );
  const captain = next.rows[0]?.user_id;
  if (captain) await tx.query('UPDATE league_teams SET captain_id = $2 WHERE id = $1 AND captain_id = $3', [teamId, captain, userId]);
  else await tx.query('DELETE FROM league_teams WHERE id = $1', [teamId]);
}

/* ------------------------------------------------------------------ */
/* Lancement                                                            */

/** Lance une ligue par équipes : équipes incomplètes dissoutes, tirage, rencontres. */
export async function launchTeams(tx: Transaction, deps: LeagueDeps, league: LeagueRow, now: Date): Promise<void> {
  const size = league.team_size!;
  const members = await loadMembers(tx, league.id);
  const teams = await loadTeams(tx, league.id);
  const full = teams.filter((t) => rosterOf(t, members).length === size);
  if (full.length < 2) throw new AppError('league.not_enough_teams', 409, { minimum: 2 });
  const params = { leagueId: league.id, leagueName: league.name, code: league.code };

  // Équipes incomplètes : leurs joueurs sont remboursés et prévenus.
  for (const t of teams.filter((x) => !full.includes(x))) {
    for (const id of rosterOf(t, members)) {
      const m = members.find((x) => x.user_id === id)!;
      await tx.query(`UPDATE league_members SET status = 'removed', entry_paid = 0, team_id = NULL WHERE league_id = $1 AND user_id = $2`, [league.id, id]);
      await refundFromPot(tx, league.id, id, m.entry_paid, `${id}:${m.joined_at.getTime()}`, 'team_incomplete');
      await deps.notifications.notify(tx, id, 'league.team_dropped', { ...params, team: t.name });
    }
    await tx.query('DELETE FROM league_teams WHERE id = $1', [t.id]);
  }

  const seed = randomBytes(16).toString('hex');
  const order = drawPlayers(
    full.map((t) => t.id),
    seed,
  );
  const rosters = new Map(full.map((t) => [t.id, rosterOf(t, members)]));
  for (const [i, id] of order.entries()) {
    await tx.query('UPDATE league_teams SET draw_order = $2 WHERE id = $1', [id, i]);
    // Départage individuel (affichage) : l'ordre des équipes, puis celui de l'équipe.
    for (const [j, userId] of rosters.get(id)!.entries()) {
      await tx.query('UPDATE league_members SET draw_order = $3 WHERE league_id = $1 AND user_id = $2', [league.id, userId, i * size + j]);
    }
  }
  const firstDay = effectiveFirstDay(league.first_day, league.default_time, now);
  await tx.query(
    `UPDATE leagues SET status = 'running', draw_seed = $2, first_day = $3, validated_at = $4, started_at = $4, closed_at = COALESCE(closed_at, $4) WHERE id = $1`,
    [league.id, seed, firstDay, now],
  );
  const started = { ...league, first_day: firstDay };
  for (const r of roundRobin(order, { doubleRound: league.double_round })) {
    for (const [i, f] of r.matches.entries()) {
      await insertTeamMatch(tx, started, f.round, i, f.home, f.away, rosters.get(f.home)!, rosters.get(f.away)!);
    }
  }
  for (const id of new Set([...rosters.values()].flat())) await deps.notifications.notify(tx, id, 'league.started', { ...params, firstDay });
}

async function insertTeamMatch(
  tx: Transaction,
  league: Pick<LeagueRow, 'id' | 'first_day' | 'rhythm' | 'default_time' | 'team_size'>,
  round: number,
  index: number,
  home: string,
  away: string,
  homeRoster: readonly string[],
  awayRoster: readonly string[],
): Promise<void> {
  const day = dayOfRound(league, round);
  const at = matchAtOf(day, league.default_time);
  const r = await tx.query<{ id: string }>(
    `INSERT INTO league_team_matches (league_id, round, home_team, away_team, match_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [league.id, round, home, away, at],
  );
  const teamMatchId = r.rows[0]!.id;
  // Dames : les planches suivent l'ordre de l'équipe jusqu'au dépôt des ordres. Ludo : une table.
  const boards =
    league.team_size === 3
      ? teamBoards(homeRoster, awayRoster).map((b) => ({ boardNo: b.board as number | null, players: [b.white, b.black] }))
      : [{ boardNo: null, players: [homeRoster[0]!, awayRoster[0]!, homeRoster[1]!, awayRoster[1]!] }];
  for (const b of boards) {
    await tx.query(
      `INSERT INTO league_matches (league_id, stage, round, tie_index, players, day, match_at, team_match_id, board_no)
       VALUES ($1, 'league', $2, $3, $4::uuid[], $5, $6, $7, $8)`,
      [league.id, round, index, b.players, day, at, teamMatchId, b.boardNo],
    );
  }
}

/* ------------------------------------------------------------------ */
/* Ordre des joueurs (Dames)                                            */

/** Le capitaine dépose (ou change) l'ordre de ses joueurs, jusqu'à 1 h avant la rencontre. */
export async function setLineup(deps: LeagueDeps, actor: Actor, leagueId: string, teamMatchId: string, order: readonly string[]): Promise<void> {
  const now = deps.clock.now();
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId);
    if (league.team_size !== 3 || league.status !== 'running') throw new AppError('league.wrong_status', 409, { status: league.status });
    const tm = (await loadTeamMatches(tx, leagueId)).find((x) => x.id === teamMatchId);
    if (!tm) throw new AppError('league.match_not_found', 404);
    const teams = await loadTeams(tx, leagueId);
    const team = teams.find((t) => (t.id === tm.home_team || t.id === tm.away_team) && t.captain_id === actor.userId);
    if (!team) throw new AppError('league.not_captain', 403);
    if (tm.lineup_locked || !lineupEditable({ now: now.getTime(), matchAt: tm.match_at.getTime() })) throw new AppError('league.too_late', 409);
    const roster = rosterOf(team, await loadMembers(tx, leagueId));
    try {
      effectiveLineup(order, roster);
    } catch {
      throw new AppError('league.lineup_invalid', 400);
    }
    await tx.query(`UPDATE league_team_matches SET lineups = lineups || $2::jsonb WHERE id = $1`, [tm.id, JSON.stringify({ [team.id]: order })]);
  });
}

/** Tâche : à l'heure limite (1 h avant), les ordres sont figés et appliqués aux planches. */
export async function applyDueLineups(deps: LeagueDeps, now: Date): Promise<void> {
  const due = await deps.db.query<{ id: string; league_id: string }>(
    `SELECT tm.id, tm.league_id FROM league_team_matches tm JOIN leagues l ON l.id = tm.league_id
      WHERE l.status = 'running' AND NOT tm.lineup_locked AND tm.match_at <= $1`,
    [new Date(now.getTime() + LINEUP_DEADLINE_MS)],
  );
  for (const row of due.rows) {
    try {
      await transaction(deps.db, async (tx) => {
        const league = await getLeague(tx, row.league_id, true);
        const tm = (await loadTeamMatches(tx, row.league_id)).find((x) => x.id === row.id);
        if (!tm || tm.lineup_locked) return;
        await tx.query('UPDATE league_team_matches SET lineup_locked = true WHERE id = $1', [tm.id]);
        if (league.team_size !== 3) return;
        const teams = await loadTeams(tx, league.id);
        const members = await loadMembers(tx, league.id);
        const lineupOf = (teamId: string) => {
          const team = teams.find((t) => t.id === teamId)!;
          return effectiveLineup(tm.lineups[teamId] ?? null, rosterOf(team, members));
        };
        const boards = teamBoards(lineupOf(tm.home_team), lineupOf(tm.away_team));
        for (const b of boards) {
          await tx.query(
            `UPDATE league_matches SET players = $3::uuid[], arrivals = '{}' WHERE team_match_id = $1 AND board_no = $2 AND status = 'scheduled'`,
            [tm.id, b.board, [b.white, b.black]],
          );
          for (const p of [b.white, b.black]) {
            await deps.notifications.notify(tx, p, 'league.lineup_locked', {
              leagueId: league.id,
              leagueName: league.name,
              code: league.code,
              board: b.board,
              color: p === b.white ? 'w' : 'b',
              at: tm.match_at.toISOString(),
            });
          }
        }
      });
    } catch (err) {
      deps.log?.error({ err, teamMatchId: row.id }, 'ordre des joueurs non appliqué');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Résultats et classement                                              */

const WHITE_WINS = new Set(['home_win', 'away_forfeit', 'home_awarded']);
const BLACK_WINS = new Set(['away_win', 'home_forfeit', 'away_awarded']);

/** Résultat d'une planche vu de la rencontre d'équipes (null : pas encore jouée). */
function boardResult(m: MatchRow): BoardResult | null {
  if (m.status !== 'played' || !m.outcome || m.board_no === null) return null;
  // Planches 1 et 3 : l'équipe qui reçoit a les blancs.
  const homeIsWhite = m.board_no % 2 === 1;
  if (m.outcome === 'draw') return 'draw';
  if (m.outcome === 'double_forfeit') return 'void';
  if (WHITE_WINS.has(m.outcome)) return homeIsWhite ? 'home' : 'away';
  if (BLACK_WINS.has(m.outcome)) return homeIsWhite ? 'away' : 'home';
  return null;
}

export interface TeamMatchState {
  match: TeamMatchRow;
  boards: MatchRow[];
  status: 'scheduled' | 'playing' | 'played' | 'cancelled';
  /** Score final, ou partiel (planches jouées) ; null si rien n'est joué. */
  score: TeamMatchScore | null;
}

export function teamMatchState(league: Pick<LeagueRow, 'team_size'>, tm: TeamMatchRow, matches: readonly MatchRow[]): TeamMatchState {
  const boards = matches.filter((m) => m.team_match_id === tm.id).sort((a, b) => (a.board_no ?? 0) - (b.board_no ?? 0));
  const done = boards.filter((b) => b.status === 'played');
  const status = boards.every((b) => b.status === 'cancelled')
    ? 'cancelled'
    : boards.length > 0 && done.length === boards.length
      ? 'played'
      : boards.some((b) => b.status === 'playing' || b.status === 'played')
        ? 'playing'
        : 'scheduled';
  let score: TeamMatchScore | null = null;
  if (league.team_size === 3) {
    const results = boards.map(boardResult);
    if (results.some((r) => r !== null)) {
      const full = damesTeamMatch(results.map((r) => r ?? 'void'));
      if (status === 'played') score = full;
      else {
        // Score en cours : points de parties seulement, pas encore de vainqueur.
        score = { ...full, winner: null, homeLeaguePoints: 0, awayLeaguePoints: 0 };
      }
    }
  } else {
    const table = boards[0];
    if (table?.status === 'played' && table.results) {
      const placeOf = (id: string | undefined) => table.results!.find((r) => r.playerId === id)?.place ?? null;
      const tokensOf = (ids: (string | undefined)[]) => table.results!.filter((r) => ids.includes(r.playerId)).reduce((s, r) => s + r.tokensHome, 0);
      const [h1, a1, h2, a2] = table.players;
      score = ludoTeamMatch({
        home: [placeOf(h1), placeOf(h2)],
        away: [placeOf(a1), placeOf(a2)],
        homeTokens: tokensOf([h1, h2]),
        awayTokens: tokensOf([a1, a2]),
        tableSize: 4,
      });
    }
  }
  return { match: tm, boards, status, score };
}

/** Classement des équipes, à partir des rencontres terminées. */
export function teamRanking(
  league: Pick<LeagueRow, 'team_size'>,
  teams: readonly TeamRow[],
  teamMatches: readonly TeamMatchRow[],
  matches: readonly MatchRow[],
): TeamStandingRow[] {
  const records: TeamMatchRecord[] = [];
  for (const tm of teamMatches) {
    const s = teamMatchState(league, tm, matches);
    if (s.status === 'played' && s.score) records.push({ round: tm.round, home: tm.home_team, away: tm.away_team, score: s.score });
  }
  const draw = [...teams].filter((t) => t.draw_order !== null).sort((a, b) => a.draw_order! - b.draw_order!).map((t) => t.id);
  return teamStandings(
    teams.map((t) => t.id),
    records,
    draw,
  );
}

/** Position de chaque joueur : celle de son équipe. */
export async function teamPositions(db: Sql, league: LeagueRow): Promise<Map<string, number>> {
  const [teams, teamMatches, matches, members] = await Promise.all([loadTeams(db, league.id), loadTeamMatches(db, league.id), loadMatches(db, league.id), loadMembers(db, league.id)]);
  const pos = new Map(teamRanking(league, teams, teamMatches, matches).map((r) => [r.team, r.position]));
  const out = new Map<string, number>();
  for (const m of members) if (m.team_id && pos.has(m.team_id)) out.set(m.user_id, pos.get(m.team_id)!);
  return out;
}

/* ------------------------------------------------------------------ */
/* Clôture                                                              */

export async function completeTeamLeague(tx: Transaction, deps: LeagueDeps, league: LeagueRow, now: Date): Promise<void> {
  const [teams, teamMatches, matches, members] = await Promise.all([
    loadTeams(tx, league.id),
    loadTeamMatches(tx, league.id),
    loadMatches(tx, league.id),
    loadMembers(tx, league.id),
  ]);
  const ranking = teamRanking(league, teams, teamMatches, matches);
  const teamOf = new Map(teams.map((t) => [t.id, t]));
  const champion = teamOf.get(ranking[0]!.team)!;
  const championRoster = rosterOf(champion, members);
  const pot = await potOf(tx, league.id);
  if (pot > 0) await payOut(tx, league.id, splitTeamPot(pot, championRoster, champion.captain_id));
  await returnCaution(tx, league.id, league.creator_id);
  const kinds = ['or', 'argent', 'bronze'] as const;
  for (const [i, kind] of kinds.entries()) {
    const row = ranking[i];
    if (!row) continue;
    for (const id of rosterOf(teamOf.get(row.team)!, members)) {
      await tx.query(`INSERT INTO medals (user_id, league_id, kind, title, awarded_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, league_id) DO NOTHING`, [
        id,
        league.id,
        kind,
        league.name,
        now,
      ]);
    }
  }
  const kindsOf = await tx.query<{ id: string; kind: string }>('SELECT id, kind::text FROM users WHERE id = ANY($1::uuid[])', [championRoster]);
  for (const u of kindsOf.rows) if (u.kind === 'member') await grantItem(tx, u.id, TROPHY_CARD, 'reward');
  await tx.query(`UPDATE leagues SET status = 'finished', finished_at = $2 WHERE id = $1`, [league.id, now]);
  for (const row of ranking) {
    const team = teamOf.get(row.team)!;
    for (const id of rosterOf(team, members)) {
      await deps.notifications.notify(tx, id, 'league.finished', { leagueId: league.id, leagueName: league.name, code: league.code, position: row.position, team: team.name });
    }
  }
}
