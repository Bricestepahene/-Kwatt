/**
 * Ce que voient les écrans des ligues : liste (27), fiche (29, 30, 32, 33), match du jour
 * (34, 34b), exclusion (35). Lecture seule.
 */
import {
  dayNumberOfKey,
  groupQualifiers,
  groupStandings,
  leaguePot,
  leagueEndDay,
  splitPot,
  winProbability,
  FORFEIT_GRACE_MS,
  type Ranking,
  type RatedVariant,
} from '@kwatt/domain';
import {
  LEAGUE_TIME_SLOTS,
  type KnockoutTie,
  type LeagueCard,
  type LeagueDetail,
  type LeagueExclusionView,
  type LeagueGroup,
  type LeagueListQuery,
  type LeagueMatchCard,
  type LeagueMatchView,
  type LeaguePlayer,
  type StandingRowView,
} from '@kwatt/protocol';
import type { Pool, Sql } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { balanceOf } from '../economy/ledger.js';
import type { MediaStore } from '../media/store.js';
import { loadLooks } from '../profiles/look.js';
import { ratingOf } from '../ratings/service.js';
import {
  championshipRanking,
  damesRecords,
  drawOrder,
  forfeitCounts,
  getLeague,
  getMatch,
  loadMatches,
  loadMembers,
  pseudosOf,
  type LeagueRow,
  type MatchRow,
  type MemberRow,
} from './model.js';
import { potOf } from './money.js';
import { dayOfRound, schedulePreview } from './schedule.js';
import { boardChooser, joinRefusal, minimumPlayers, ROOM_OPENS_BEFORE_MS, tieOutcome, tiesOf, type Actor } from './service.js';

const HOUR = 3_600_000;

/** Joueurs (pseudo et apparence) par identifiant. */
async function players(db: Sql, media: MediaStore, ids: readonly string[], viewerId: string): Promise<Map<string, LeaguePlayer>> {
  const unique = [...new Set(ids)];
  const [names, looks] = await Promise.all([pseudosOf(db, unique), loadLooks(db, media, unique, viewerId)]);
  return new Map(unique.map((id) => [id, { userId: id, pseudo: names.get(id) ?? '?', avatar: looks.get(id) ?? null }]));
}

function playerOf(map: Map<string, LeaguePlayer>, id: string): LeaguePlayer {
  return map.get(id) ?? { userId: id, pseudo: '?', avatar: null };
}

function matchCard(m: MatchRow, map: Map<string, LeaguePlayer>): LeagueMatchCard {
  return {
    id: m.id,
    stage: m.stage,
    round: m.round,
    group: m.group_index,
    tie: m.tie_index,
    leg: m.leg,
    day: m.day,
    matchAt: m.match_at.toISOString(),
    players: m.players.map((p) => playerOf(map, p)),
    board: m.board,
    status: m.status,
    outcome: m.outcome,
    places: m.results ? Object.fromEntries(m.results.map((r) => [r.playerId, r.place])) : null,
    timeAgreed: m.time_agreed,
    gameId: m.game_id,
  };
}

function zoneOf(position: number, count: number, relegated: number): StandingRowView['zone'] {
  if (position === 1) return 'champion';
  if (position <= 3) return 'podium';
  if (relegated > 0 && position > count - relegated) return 'relegation';
  return 'none';
}

function rowsOf(ranking: Ranking, map: Map<string, LeaguePlayer>, relegated: number, excluded: ReadonlySet<string> = new Set()): StandingRowView[] {
  return ranking.rows.map((r) => ({
    player: playerOf(map, r.playerId),
    position: r.position,
    played: r.played,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    forfeits: r.forfeits,
    penalties: r.penalties,
    points: r.points,
    tiebreak: r.tiebreakValue,
    excluded: excluded.has(r.playerId),
    zone: zoneOf(r.position, ranking.rows.length, relegated),
  }));
}

/** Journée en cours : la première qui a encore un match à jouer, sinon la dernière. */
function currentRound(matches: readonly MatchRow[]): number {
  const open = matches.filter((m) => m.status === 'scheduled' || m.status === 'playing').map((m) => m.round);
  if (open.length) return Math.min(...open);
  const all = matches.filter((m) => m.status !== 'cancelled').map((m) => m.round);
  return all.length ? Math.max(...all) : 0;
}

/* ------------------------------------------------------------------ */
/* Liste (écran 27)                                                     */

export async function listLeagues(db: Pool, userId: string, query: LeagueListQuery): Promise<LeagueCard[]> {
  const game = query.game === 'all' ? null : query.game;
  const r = await db.query<{ id: string }>(
    query.scope === 'mine'
      ? `SELECT l.id FROM leagues l
          WHERE (l.creator_id = $1 OR EXISTS (SELECT 1 FROM league_members m WHERE m.league_id = l.id AND m.user_id = $1 AND m.status IN ('active','excluded')))
            AND ($2::text IS NULL OR l.game = $2) AND l.status <> 'cancelled'
          ORDER BY (l.status = 'finished'), l.created_at DESC LIMIT 50`
      : `SELECT l.id FROM leagues l
          WHERE l.access = 'public' AND l.status IN ('registration','running') AND ($1::text IS NULL OR l.game = $1)
          ORDER BY (l.status = 'running'), l.registration_closes_at NULLS LAST, l.created_at DESC LIMIT 50`,
    query.scope === 'mine' ? [userId, game] : [game],
  );
  const out: LeagueCard[] = [];
  for (const { id } of r.rows) {
    const league = await getLeague(db, id);
    const members = await loadMembers(db, id);
    const matches = await loadMatches(db, id);
    const active = members.filter((m) => m.status === 'active');
    const preview = schedulePreview(league, Math.max(active.length, 2));
    const totalRounds = matches.length ? Math.max(...matches.map((m) => m.round)) : preview.rounds;
    let myPosition: number | null = null;
    if (active.some((m) => m.user_id === userId) && matches.length) {
      myPosition = positionsFor(league, members, matches).get(userId) ?? null;
    }
    out.push({
      id,
      code: league.code,
      name: league.name,
      game: league.game,
      access: league.access,
      format: league.format,
      status: league.status,
      players: active.length,
      maxPlaces: league.max_places,
      entry: league.entry,
      minRank: league.min_rank,
      currentRound: matches.length ? currentRound(matches) : 0,
      totalRounds,
      doubleRound: league.double_round,
      groups: league.groups,
      myPosition,
      placesLeft: Math.max(0, league.max_places - active.length),
      registrationClosesAt: league.registration_closes_at?.toISOString() ?? null,
    });
  }
  return out;
}

function positionsFor(league: LeagueRow, members: readonly MemberRow[], matches: readonly MatchRow[]): Map<string, number> {
  const active = members.filter((m) => m.status === 'active');
  if (league.format === 'cup') {
    const out = new Map<string, number>();
    for (let g = 0; g < (league.groups ?? 1); g++) {
      const ids = active.filter((m) => m.group_index === g).map((m) => m.user_id);
      for (const row of groupStandings(ids, damesRecords(matches, 'group', g), league.qualifiers_per_group ?? 2, { draw: drawOrder(members) }).rows) {
        out.set(row.playerId, row.position);
      }
    }
    return out;
  }
  return new Map(championshipRanking(league, active, matches).rows.map((r) => [r.playerId, r.position]));
}

/* ------------------------------------------------------------------ */
/* Fiche d'une ligue                                                    */

export async function leagueDetail(db: Pool, media: MediaStore, actor: Actor, leagueId: string): Promise<LeagueDetail> {
  const league = await getLeague(db, leagueId);
  const members = await loadMembers(db, leagueId);
  const matches = await loadMatches(db, leagueId);
  const active = members.filter((m) => m.status === 'active');
  const excludedIds = new Set(members.filter((m) => m.status === 'excluded').map((m) => m.user_id));
  const map = await players(db, media, [league.creator_id, ...members.map((m) => m.user_id), ...matches.flatMap((m) => m.players)], actor.userId);

  // Classement : les exclus sont retirés (leurs résultats sont traités par la règle d'exclusion).
  let standings: StandingRowView[] = [];
  const groupTables: LeagueGroup[] = [];
  if (league.format === 'cup') {
    for (let g = 0; g < (league.groups ?? 0); g++) {
      const ids = active.filter((m) => m.group_index === g).map((m) => m.user_id);
      if (ids.length === 0 && matches.length === 0) continue;
      const q = league.qualifiers_per_group ?? 2;
      const ranking = groupStandings(ids, damesRecords(matches, 'group', g), q, { draw: drawOrder(members), playoffOrder: drawOrder(members) });
      groupTables.push({ index: g, rows: rowsOf(ranking, map, 0), qualifiers: groupQualifiers(ranking, q) });
    }
  } else if (matches.length > 0) {
    standings = rowsOf(championshipRanking(league, active, matches), map, league.relegated);
    const forfeits = forfeitCounts(matches);
    for (const id of excludedIds) {
      standings.push({
        player: playerOf(map, id),
        position: standings.length + 1,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        forfeits: forfeits.get(id) ?? 0,
        penalties: 0,
        points: 0,
        tiebreak: 0,
        excluded: true,
        zone: 'none',
      });
    }
  }

  const knockout: KnockoutTie[] = [];
  const ties = tiesOf(matches);
  const seeds = new Map<string, string>();
  for (const g of groupTables) g.qualifiers.forEach((id, i) => seeds.set(id, `${String.fromCharCode(65 + g.index)}${i + 1}`));
  for (const t of ties) {
    const o = tieOutcome(t);
    const tiesAtLevel = ties.filter((x) => x.level === t.level).length;
    knockout.push({
      tie: t.index,
      level: t.level,
      tiesAtLevel,
      first: playerOf(map, t.tie.first),
      second: playerOf(map, t.tie.second),
      firstSeed: t.level === 1 ? (seeds.get(t.tie.first) ?? null) : null,
      secondSeed: t.level === 1 ? (seeds.get(t.tie.second) ?? null) : null,
      firstScore: o.firstScore,
      secondScore: o.secondScore,
      winner: o.winner,
      deciderNeeded: o.deciderNeeded,
      matches: [...t.legs, ...t.deciders].map((m) => matchCard(m, map)),
    });
  }

  const pot = await potOf(db, leagueId);
  const entrants = Math.max(active.length, 1);
  const preview = schedulePreview(league, Math.max(active.length, 2));
  const totalRounds = matches.length ? Math.max(...matches.map((m) => m.round)) : preview.rounds;
  const totalMatches = matches.length ? matches.filter((m) => m.status !== 'cancelled').length : preview.matches;
  const rounds = currentRound(matches);
  const roundMatches = matches.filter((m) => m.round === rounds && m.status !== 'cancelled').map((m) => matchCard(m, map));
  const potForPrizes = league.status === 'registration' || league.status === 'awaiting_validation' ? leaguePot(entrants, league.entry) : pot;
  const prizes =
    league.access === 'public'
      ? (() => {
          const s = splitPot({ pot: potForPrizes, ranking: ['a', 'b', 'c'], finishers: Array.from({ length: entrants }, (_, i) => `p${i}`), creatorId: 'c0' });
          return { first: s.first, second: s.second, third: s.third, participationEach: s.participationEach, creator: s.creator };
        })()
      : { first: pot, second: 0, third: 0, participationEach: 0, creator: 0 };

  const me = members.find((m) => m.user_id === actor.userId);
  const next = matches
    .filter((m) => (m.status === 'scheduled' || m.status === 'playing') && m.players.includes(actor.userId))
    .sort((a, b) => a.match_at.getTime() - b.match_at.getTime())[0];
  const exclusions = await db.query<{ user_id: string; created_at: Date }>('SELECT user_id, created_at FROM league_exclusions WHERE league_id = $1 ORDER BY created_at', [
    leagueId,
  ]);
  const medals = await db.query<{ user_id: string; kind: 'or' | 'argent' | 'bronze' }>(
    `SELECT user_id, kind FROM medals WHERE league_id = $1 ORDER BY array_position(ARRAY['or','argent','bronze'], kind)`,
    [leagueId],
  );
  const medalPlayers = await players(db, media, medals.rows.map((m) => m.user_id), actor.userId);
  const refusal = me && (me.status === 'active' || me.status === 'excluded') ? null : await joinRefusal(db, league, actor, active.length);
  const endDay = matches.length
    ? matches.filter((m) => m.status !== 'cancelled').reduce((d, m) => (m.day > d ? m.day : d), league.first_day)
    : league.rhythm === 'weekly'
      ? dayOfRound(league, Math.max(1, preview.rounds))
      : leagueEndDay(league.first_day, Math.max(1, preview.rounds));

  return {
    id: league.id,
    code: league.code,
    name: league.name,
    game: league.game,
    access: league.access,
    format: league.format,
    status: league.status,
    creator: playerOf(map, league.creator_id),
    maxPlaces: league.max_places,
    minPlayers: minimumPlayers(league),
    entry: league.entry,
    caution: league.caution,
    pot,
    potIfFull: league.access === 'public' ? leaguePot(league.max_places, league.entry) : league.max_places * league.entry,
    prizes,
    minRank: league.min_rank,
    boardRules: league.board_rules,
    defaultTime: league.default_time,
    rhythm: league.rhythm,
    doubleRound: league.double_round,
    groups: league.groups,
    qualifiersPerGroup: league.qualifiers_per_group,
    relegated: league.relegated,
    firstDay: league.first_day,
    endDay,
    totalRounds,
    totalMatches,
    matchesPerRound: preview.perRound,
    currentRound: rounds,
    registrationClosesAt: league.registration_closes_at?.toISOString() ?? null,
    validationDeadline: league.closed_at && league.status === 'awaiting_validation' ? new Date(league.closed_at.getTime() + 48 * HOUR).toISOString() : null,
    drawSeed: league.draw_seed,
    members: members.map((m) => ({ player: playerOf(map, m.user_id), status: m.status === 'excluded' ? 'excluded' : 'active', joinedAt: m.joined_at.toISOString() })),
    standings,
    groupTables,
    knockout,
    roundMatches,
    exclusions: exclusions.rows.map((e) => ({ player: playerOf(map, e.user_id), at: e.created_at.toISOString() })),
    me: {
      member: !!me,
      creator: league.creator_id === actor.userId,
      excluded: me?.status === 'excluded',
      joinRefusal: refusal,
      nextMatch: next ? matchCard(next, map) : null,
      balance: actor.kind === 'member' ? await balanceOf(db, actor.userId) : null,
    },
    medals: medals.rows.map((m) => ({ player: playerOf(medalPlayers, m.user_id), kind: m.kind })),
  };
}

/* ------------------------------------------------------------------ */
/* Match du jour (écrans 34 et 34b)                                     */

export async function matchView(db: Pool, media: MediaStore, actor: Actor, leagueId: string, matchId: string, now: Date): Promise<LeagueMatchView> {
  const league = await getLeague(db, leagueId);
  const match = await getMatch(db, leagueId, matchId);
  if (!match.players.includes(actor.userId)) throw new AppError('league.not_in_match', 403);
  const members = await loadMembers(db, leagueId);
  const matches = await loadMatches(db, leagueId);
  const map = await players(db, media, match.players, actor.userId);
  const pos = positionsFor(league, members, matches);
  const forfeits = forfeitCounts(matches);
  const previous = matches.filter((m) => m.round === match.round - 1 && m.status === 'played');
  const forfeitedLast = (id: string) =>
    previous.some(
      (m) =>
        m.players.includes(id) &&
        ((m.outcome === 'home_forfeit' && m.players[0] === id) ||
          (m.outcome === 'away_forfeit' && m.players[1] === id) ||
          m.outcome === 'double_forfeit' ||
          (m.results?.some((r) => r.playerId === id && r.place === null) ?? false)),
    );

  // Écran 34b : force de chacun sur chaque planche classée permise.
  const boardOdds: LeagueMatchView['boardOdds'] = [];
  for (const board of league.board_rules.allowed) {
    const ratings: Record<string, number> = {};
    const rated = board === 'dames10' || board === 'dames8' || board === 'ludo_classique' || board === 'ludo_rapide' || board === 'ludo_six';
    for (const p of match.players) ratings[p] = rated ? (await ratingOf(db, p, board as RatedVariant)).rating : 0;
    const opponents = match.players.filter((p) => p !== actor.userId);
    const myWinChance = rated && opponents.length === 1 ? winProbability(ratings[actor.userId]!, ratings[opponents[0]!]!) : null;
    boardOdds.push({ board, ratings, myWinChance });
  }
  // Retour de coupe : planche de l'aller.
  const firstLeg =
    match.stage === 'knockout' && match.leg === 2
      ? matches.find((m) => m.stage === 'knockout' && m.level === match.level && m.tie_index === match.tie_index && m.leg === 1)
      : undefined;

  const dayStart = dayNumberOfKey(match.day) * 24 * HOUR - 60 * 60_000; // minuit, heure du Cameroun (UTC+1)
  return {
    league: { id: league.id, code: league.code, name: league.name, game: league.game, format: league.format, entry: league.entry },
    match: matchCard(match, map),
    dayEndsAt: new Date(dayStart + 24 * HOUR).toISOString(),
    timeProposals: Object.fromEntries(match.players.map((p) => [p, match.time_proposals[p] ?? null])),
    defaultTime: league.default_time,
    slots: [...new Set([...LEAGUE_TIME_SLOTS, league.default_time])].sort(),
    timeEditable: match.status === 'scheduled' && match.match_at.getTime() - now.getTime() >= HOUR,
    boardRules: league.board_rules,
    boardChooser: boardChooser(league, match, actor.userId),
    boardChoices: Object.fromEntries(match.players.map((p) => [p, match.board_choices[p]?.board ?? null])),
    boardDeadline: new Date(match.match_at.getTime() - 24 * HOUR).toISOString(),
    firstLegBoard: firstLeg?.board ?? null,
    boardOdds,
    arrivals: Object.fromEntries(match.players.map((p) => [p, match.arrivals[p] ?? null])),
    roomOpensAt: new Date(match.match_at.getTime() - ROOM_OPENS_BEFORE_MS).toISOString(),
    forfeitAt: new Date(match.match_at.getTime() + FORFEIT_GRACE_MS).toISOString(),
    players: match.players.map((p) => ({ player: playerOf(map, p), position: pos.get(p) ?? null, forfeits: forfeits.get(p) ?? 0, forfeitedLastRound: forfeitedLast(p) })),
    fine: Math.floor((league.entry * 10) / 100),
  };
}

/* ------------------------------------------------------------------ */
/* Exclusion (écran 35)                                                 */

interface ExclusionDetails {
  forfeitRounds: number[];
  reason: 'consecutive' | 'total';
  policy: 'annulled' | 'kept';
  elapsed: number;
  totalMatches: number;
  remainingPlayers: number;
  changes: { userId: string; round: number; result: 'win' | 'draw' | 'loss' | 'forfeit_win' | 'awarded'; points: number }[];
  positions: Record<string, { before: number; after: number }>;
  calendar: {
    mode: 'bye' | 'repacked';
    rested: { round: number; userId: string }[];
    changedFor: string[];
    remainingMatches: number;
    matchesPerRound: number;
    endDayBefore: string;
    endDayAfter: string;
  };
  money: { refund: number; remaining: number; fines: number; potBefore: number; potAfter: number };
}

export async function exclusionView(db: Pool, media: MediaStore, actor: Actor, leagueId: string, userId: string): Promise<LeagueExclusionView> {
  const league = await getLeague(db, leagueId);
  const r = await db.query<{ round: number; details: ExclusionDetails; created_at: Date }>(
    'SELECT round, details, created_at FROM league_exclusions WHERE league_id = $1 AND user_id = $2',
    [leagueId, userId],
  );
  const row = r.rows[0];
  if (!row) throw new AppError('league.not_found', 404);
  const d = row.details;
  const map = await players(db, media, [userId, ...d.changes.map((c) => c.userId), ...d.calendar.rested.map((x) => x.userId)], actor.userId);
  const mine = d.positions[actor.userId];
  const endDayBefore = d.calendar.endDayBefore || league.first_day;
  return {
    league: { id: league.id, code: league.code, name: league.name, game: league.game, entry: league.entry },
    excluded: playerOf(map, userId),
    at: row.created_at.toISOString(),
    round: row.round,
    forfeitRounds: d.forfeitRounds,
    reason: d.reason,
    policy: d.policy,
    elapsed: d.elapsed,
    totalMatches: d.totalMatches,
    remainingPlayers: d.remainingPlayers,
    changes: d.changes.map((c) => ({ player: playerOf(map, c.userId), round: c.round, result: c.result, points: c.points })),
    myPosition: mine ? { before: mine.before, after: mine.after } : null,
    calendar: {
      mode: d.calendar.mode,
      rested: d.calendar.rested.map((x) => ({ round: x.round, player: playerOf(map, x.userId) })),
      remainingMatches: d.calendar.remainingMatches,
      matchesPerRound: d.calendar.matchesPerRound,
      endDayBefore,
      endDayAfter: d.calendar.endDayAfter || endDayBefore,
      mineChanged: d.calendar.changedFor.includes(actor.userId),
    },
    money: d.money,
  };
}
