/**
 * Ligues : cycle de vie (création, inscriptions, validation, lancement, annulation),
 * matchs du jour (heure, planche, présence, forfaits), exclusions, coupe, clôture.
 *
 * Le serveur fait foi : chaque décision est calculée ici avec @kwatt/domain à partir de la
 * base, écrite, puis notifiée. Les cauris passent par le grand livre (money.ts).
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  applyExclusion,
  attendanceOutcome,
  boardIsRated,
  cancelAfterValidation,
  dayKey,
  decideBoard,
  deciderWhite,
  exclusionDue,
  forfeitFine,
  forfeitedBy,
  groupQualifiers,
  groupStandings,
  knockoutPairs,
  kwattBonus,
  leagueCaution,
  leagueJoinRefusal,
  leagueMinimumPlayers,
  matchPoints,
  matchesPerPlayer,
  nextRoundPairs,
  packFixtures,
  publicLeagueCreationRefusal,
  rankForRating,
  splitPot,
  splitPrivatePot,
  twoLegTie,
  validateBoardRules,
  withExcludedAsBye,
  FORFEIT_GRACE_MS,
  type Board,
  type BoardRules,
  type GameResult,
  type MatchOutcome,
  type MatchRecord,
  type RankId,
  type RatedVariant,
  type Tie,
} from '@kwatt/domain';
import { LEAGUE_TIME_SLOTS, type CreateLeagueBody, type ErrorCode, type LeagueBoard } from '@kwatt/protocol';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { sharedDevicePairs } from '../auth/devices.js';
import { balanceOf } from '../economy/ledger.js';
import type { MediaStore } from '../media/store.js';
import type { NotificationService } from '../notifications/service.js';
import { ratingOf } from '../ratings/service.js';
import { grantItem } from '../shop/catalog.js';
import { DECIDER_CLOCK, LEAGUE_CLOCK, leagueGames, type LeagueGameFinished } from './games.js';
import {
  attendanceRecords,
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
  type LudoSeatResult,
  type MatchRow,
  type MemberRow,
} from './model.js';
import {
  afterTeamMemberLeft,
  checkTeamSettings,
  completeTeamLeague,
  createCreatorTeam,
  launchTeams,
  LUDO_TEAM_SEATS,
  teamCapacity,
} from './teams.js';
import { lockCaution, payBonus, payEntry, payFine, payOut, potOf, refundFromPot, returnCaution, shareCaution, takeBackBonus } from './money.js';
import {
  asFixtures,
  championshipFixtures,
  dayOfRound,
  drawPlayers,
  effectiveFirstDay,
  groupFixtures,
  insertMatches,
  ludoFixtures,
  ludoRoundCount,
  ludoTableSize,
  matchAtOf,
  type PlannedMatch,
} from './schedule.js';

export interface LeagueDeps {
  db: Pool;
  clock: Clock;
  notifications: Pick<NotificationService, 'notify'>;
  media: MediaStore;
  log?: Logger;
}

/** Qui agit (contexte d'authentification). */
export interface Actor {
  userId: string;
  kind: 'guest' | 'member';
  ageGroup: 'teen' | 'adult' | null;
}

/** Carte trophée du champion (écran 28). */
export const TROPHY_CARD = 'card_trophee_ngondo';
/** Salle du match ouverte 15 minutes avant l'heure. */
export const ROOM_OPENS_BEFORE_MS = 15 * 60_000;
/** L'heure se change jusqu'à 1 h avant le match. */
export const TIME_CHANGE_LIMIT_MS = 3_600_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOUR = 3_600_000;

const DAMES_BOARDS: readonly LeagueBoard[] = ['dames10', 'dames8'];

/* ------------------------------------------------------------------ */
/* Aides                                                                */

function newCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

function settingsInvalid(reason: string): AppError {
  return new AppError('league.settings_invalid', 400, { reason });
}

function wrongStatus(league: LeagueRow): AppError {
  return new AppError('league.wrong_status', 409, { status: league.status });
}

/** Variante dont la force sert pour l'échelon (accès et ligue publique). */
function rankVariant(league: Pick<LeagueRow, 'game' | 'board_rules'>): RatedVariant {
  const d = league.board_rules.defaultBoard;
  if (boardIsRated(d)) return d as RatedVariant;
  return league.game === 'dames' ? 'dames10' : 'ludo_classique';
}

async function rankOf(db: Sql, userId: string, variant: RatedVariant): Promise<RankId> {
  const { rating } = await ratingOf(db, userId, variant);
  return rankForRating(rating).id;
}

function ageOf(actor: Actor): number | null {
  // L'âge exact n'est jamais lu : seule la tranche compte (13–17 ou 18 ans et plus).
  return actor.ageGroup === 'adult' ? 18 : actor.ageGroup === 'teen' ? 15 : null;
}

/** Minimum d'inscrits pour lancer. */
export function minimumPlayers(league: Pick<LeagueRow, 'access' | 'format' | 'max_places' | 'groups'>): number {
  if (league.access === 'public') return leagueMinimumPlayers(league.max_places);
  if (league.format === 'cup') return Math.max(2, (league.groups ?? 1) * 2);
  return 2;
}

async function notifyAll(deps: LeagueDeps, tx: Transaction, userIds: readonly string[], kind: string, params: Record<string, unknown>): Promise<void> {
  for (const id of new Set(userIds)) await deps.notifications.notify(tx, id, kind, params);
}

function leagueParams(league: LeagueRow): Record<string, unknown> {
  return { leagueId: league.id, leagueName: league.name, code: league.code };
}

/* ------------------------------------------------------------------ */
/* Création                                                             */

function checkBoards(body: CreateLeagueBody): void {
  const allowedForGame = (b: LeagueBoard) => (body.game === 'dames' ? DAMES_BOARDS.includes(b) : !DAMES_BOARDS.includes(b));
  if (![...body.boardRules.allowed, body.boardRules.defaultBoard].every(allowedForGame)) throw new AppError('competition.board_not_allowed', 400);
  if (new Set(body.boardRules.allowed).size !== body.boardRules.allowed.length) throw settingsInvalid('boards_duplicate');
  const context = body.access === 'public' ? 'public_league' : 'private_league';
  const refusal = validateBoardRules(body.boardRules as BoardRules, context, body.entry > 0);
  if (refusal) throw new AppError(refusal as ErrorCode, 400);
  // Au Ludo, personne ne « reçoit » : la règle « qui reçoit » n'a pas de sens.
  if (body.game === 'ludo' && body.boardRules.policy === 'home') throw settingsInvalid('home_ludo');
}

function checkFormat(body: CreateLeagueBody): void {
  if (body.format === 'cup') {
    // V1 : la coupe (aller-retour, manche décisive) se joue aux Dames.
    if (body.game !== 'dames') throw settingsInvalid('cup_ludo');
    const groups = body.groups ?? 2;
    const q = body.qualifiersPerGroup ?? 2;
    const qualified = groups * q;
    if (body.maxPlaces < groups * 2) throw settingsInvalid('groups_too_many');
    // Tableau à élimination : 2, 4, 8, 16… qualifiés ; deux qualifiés par poule demandent un nombre pair de poules.
    if (qualified < 2 || (qualified & (qualified - 1)) !== 0) throw settingsInvalid('qualified_not_power_of_two');
    if (q === 2 && groups > 1 && groups % 2 === 1) throw settingsInvalid('groups_odd');
    if (q === 1 && groups === 1) throw settingsInvalid('qualified_not_power_of_two');
  }
}

export async function createLeague(deps: LeagueDeps, actor: Actor, body: CreateLeagueBody): Promise<string> {
  const now = deps.clock.now();
  if (actor.kind !== 'member') throw new AppError('league.guest', 403);
  checkBoards(body);
  checkFormat(body);
  checkTeamSettings(body);
  const today = dayKey(now.getTime());
  if (body.firstDay < today) throw settingsInvalid('first_day_past');
  const variant = rankVariant({ game: body.game, board_rules: body.boardRules as LeagueRow['board_rules'] });

  return transaction(deps.db, async (tx) => {
    let closesAt: Date | null = null;
    let caution = 0;
    if (body.access === 'public') {
      if (!body.registrationClosesAt) throw settingsInvalid('registration_closes_at');
      closesAt = new Date(body.registrationClosesAt);
      if (closesAt.getTime() <= now.getTime()) throw settingsInvalid('registration_closes_at');
      // Les matchs commencent après la clôture des inscriptions (la validation peut prendre 48 h).
      if (body.firstDay <= dayKey(closesAt.getTime())) throw settingsInvalid('first_day_before_closing');
      const refusal = publicLeagueCreationRefusal({
        kind: actor.kind,
        age: ageOf(actor),
        rank: await rankOf(tx, actor.userId, variant),
        balance: await balanceOf(tx, actor.userId),
        maxPlaces: body.maxPlaces,
        entry: body.entry,
      });
      if (refusal) throw new AppError(refusal, refusal === 'league.caution_above_balance' ? 409 : 403);
      caution = leagueCaution(body.maxPlaces);
    } else if (body.entry > 0 && actor.ageGroup !== 'adult') {
      throw new AppError('league.underage_paid', 403);
    }

    let id: string | null = null;
    for (let attempt = 0; attempt < 8 && !id; attempt++) {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO leagues (code, name, game, access, format, creator_id, max_places, entry, caution, min_rank, double_round,
                              groups, qualifiers_per_group, rounds, relegated, board_rules, default_time, rhythm, first_day,
                              registration_closes_at, team_size, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (code) DO NOTHING RETURNING id`,
        [
          newCode(),
          body.name,
          body.game,
          body.access,
          body.format,
          actor.userId,
          body.maxPlaces,
          body.entry,
          caution,
          body.minRank,
          body.doubleRound,
          body.format === 'cup' ? (body.groups ?? 2) : null,
          body.format === 'cup' ? (body.qualifiersPerGroup ?? 2) : null,
          body.game === 'ludo' ? (body.rounds ?? null) : null,
          body.relegated,
          JSON.stringify(body.boardRules),
          body.defaultTime,
          body.rhythm,
          body.firstDay,
          closesAt,
          body.teamSize,
          now,
        ],
      );
      id = r.rows[0]?.id ?? null;
    }
    if (!id) throw new Error('code de ligue introuvable après 8 essais');
    await lockCaution(tx, id, actor.userId, caution);
    // Ligue privée : le créateur joue (il paie son entrée comme les autres).
    // Ligue par équipes : il crée son équipe et en est le capitaine.
    if (body.access === 'private') {
      const league = await getLeague(tx, id, true);
      if (body.teamSize !== null) await createCreatorTeam(tx, league, body.teamName!, now);
      else await addMember(tx, league, actor.userId, now);
    }
    return id;
  });
}

export async function addMember(tx: Transaction, league: LeagueRow, userId: string, now: Date, teamId: string | null = null): Promise<void> {
  const prev = await tx.query<{ status: string; n: number }>(
    `SELECT status, (SELECT count(*)::int FROM ledger_transactions WHERE idempotency_key LIKE $3) AS n
       FROM league_members WHERE league_id = $1 AND user_id = $2`,
    [league.id, userId, `league_entry:${league.id}:${userId}:%`],
  );
  const row = prev.rows[0];
  if (row && (row.status === 'active' || row.status === 'excluded')) throw new AppError('league.already_member', 409);
  if (row) {
    await tx.query(
      `UPDATE league_members SET status = 'active', joined_at = $3, entry_paid = $4, refunded = 0, seq = nextval('league_members_seq_seq'), team_id = $5
        WHERE league_id = $1 AND user_id = $2`,
      [league.id, userId, now, league.entry, teamId],
    );
  } else {
    await tx.query(`INSERT INTO league_members (league_id, user_id, joined_at, entry_paid, team_id) VALUES ($1, $2, $3, $4, $5)`, [
      league.id,
      userId,
      now,
      league.entry,
      teamId,
    ]);
  }
  await payEntry(tx, league.id, userId, league.entry, row?.n ?? 0);
}

/* ------------------------------------------------------------------ */
/* Inscriptions                                                         */

/** Refus d'inscription (code), ou null si possible. */
export async function joinRefusal(db: Sql, league: LeagueRow, actor: Actor, entrants: number): Promise<ErrorCode | null> {
  if (league.status !== 'registration') return 'league.wrong_status';
  // Ligue par équipes : maxPlaces compte les équipes ; complète quand on ne peut plus ni créer ni rejoindre.
  if (league.team_size) {
    const cap = await teamCapacity(db, league);
    if (!cap.canCreate && !cap.canJoin) return 'league.full';
    entrants = 0;
  }
  const refusal = leagueJoinRefusal({
    access: league.access,
    entry: league.entry,
    entrants,
    maxPlaces: league.max_places,
    kind: actor.kind,
    age: ageOf(actor),
    rank: await rankOf(db, actor.userId, rankVariant(league)),
    minRank: league.min_rank,
    balance: await balanceOf(db, actor.userId),
  });
  if (refusal) return refusal;
  // Une ligue payante ressemble à une mise : jamais deux comptes du même appareil.
  if (league.entry > 0) {
    const members = await db.query<{ user_id: string }>(`SELECT user_id FROM league_members WHERE league_id = $1 AND status = 'active'`, [league.id]);
    const ids = members.rows.map((m) => m.user_id).filter((id) => id !== actor.userId);
    if ((await sharedDevicePairs(db, [actor.userId, ...ids])).some(([a, b]) => a === actor.userId || b === actor.userId)) return 'league.same_device';
  }
  return null;
}

export async function joinLeague(deps: LeagueDeps, actor: Actor, leagueId: string): Promise<void> {
  const now = deps.clock.now();
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    if (league.team_size) throw new AppError('league.team_required', 409);
    const members = await loadMembers(tx, leagueId);
    if (members.some((m) => m.user_id === actor.userId)) throw new AppError('league.already_member', 409);
    const refusal = await joinRefusal(tx, league, actor, members.filter((m) => m.status === 'active').length);
    if (refusal) {
      const status = refusal === 'league.insufficient_balance' || refusal === 'league.full' || refusal === 'league.wrong_status' ? 409 : 403;
      throw new AppError(refusal, status, refusal === 'league.wrong_status' ? { status: league.status } : {});
    }
    await addMember(tx, league, actor.userId, now);
  });
}

async function releaseMember(tx: Transaction, league: LeagueRow, userId: string, status: 'left' | 'removed'): Promise<void> {
  const r = await tx.query<{ entry_paid: number; joined_at: Date }>(
    `SELECT entry_paid, joined_at FROM league_members WHERE league_id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE`,
    [league.id, userId],
  );
  const m = r.rows[0];
  if (!m) throw new AppError('league.not_member', 404);
  await tx.query(`UPDATE league_members SET status = $3, entry_paid = 0 WHERE league_id = $1 AND user_id = $2`, [league.id, userId, status]);
  await afterTeamMemberLeft(tx, league, userId);
  await refundFromPot(tx, league.id, userId, m.entry_paid, `${userId}:${m.joined_at.getTime()}`, status);
}

export async function leaveLeague(deps: LeagueDeps, actor: Actor, leagueId: string): Promise<void> {
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    if (league.status !== 'registration') throw wrongStatus(league);
    if (league.creator_id === actor.userId && league.access === 'private') throw new AppError('league.creator_cannot_leave', 409);
    await releaseMember(tx, league, actor.userId, 'left');
  });
}

export async function removeMember(deps: LeagueDeps, actor: Actor, leagueId: string, userId: string): Promise<void> {
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    if (league.creator_id !== actor.userId) throw new AppError('league.not_creator', 403);
    if (league.status !== 'registration' && league.status !== 'awaiting_validation') throw wrongStatus(league);
    if (userId === actor.userId && league.access === 'private') throw new AppError('league.creator_cannot_leave', 409);
    await releaseMember(tx, league, userId, 'removed');
    await deps.notifications.notify(tx, userId, 'league.removed', leagueParams(league));
  });
}

/* ------------------------------------------------------------------ */
/* Lancement : tirage, calendrier                                       */

async function launch(tx: Transaction, deps: LeagueDeps, league: LeagueRow, now: Date): Promise<void> {
  if (league.team_size) {
    await launchTeams(tx, deps, league, now);
    return;
  }
  const members = (await loadMembers(tx, league.id)).filter((m) => m.status === 'active');
  const minimum = minimumPlayers(league);
  if (members.length < minimum) throw new AppError('league.not_enough_players', 409, { minimum });

  const seed = randomBytes(16).toString('hex');
  const order = drawPlayers(
    members.map((m) => m.user_id),
    seed,
  );
  for (const [i, id] of order.entries()) {
    await tx.query('UPDATE league_members SET draw_order = $3 WHERE league_id = $1 AND user_id = $2', [league.id, id, i]);
  }
  const firstDay = effectiveFirstDay(league.first_day, league.default_time, now);
  const bonus = league.access === 'public' ? kwattBonus(members.length, league.entry) : 0;
  await payBonus(tx, league.id, bonus);
  await tx.query(
    `UPDATE leagues SET status = 'running', draw_seed = $2, first_day = $3, validated_at = $4, started_at = $4, bonus = $5,
                        closed_at = COALESCE(closed_at, $4)
      WHERE id = $1`,
    [league.id, seed, firstDay, now, bonus],
  );
  const started = { ...league, first_day: firstDay, draw_seed: seed, status: 'running' as const };

  let planned: PlannedMatch[];
  if (league.game === 'ludo') {
    planned = ludoFixtures(order, ludoRoundCount(league, order.length), ludoTableSize(league), seed);
  } else if (league.format === 'cup') {
    const g = groupFixtures(order, league.groups ?? 2, league.double_round);
    for (const [index, players] of g.groups.entries()) {
      await tx.query('UPDATE league_members SET group_index = $3 WHERE league_id = $1 AND user_id = ANY($2::uuid[])', [league.id, players, index]);
    }
    planned = g.matches;
  } else {
    planned = championshipFixtures(order, league.double_round);
  }
  await insertMatches(tx, started, planned);
  await notifyAll(
    deps,
    tx,
    members.map((m) => m.user_id),
    'league.started',
    { ...leagueParams(league), firstDay },
  );
}

/** Ligue privée : le créateur lance quand il veut (assez d'inscrits). */
export async function startLeague(deps: LeagueDeps, actor: Actor, leagueId: string): Promise<void> {
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    if (league.creator_id !== actor.userId) throw new AppError('league.not_creator', 403);
    if (league.access !== 'private' || league.status !== 'registration') throw wrongStatus(league);
    await launch(tx, deps, league, deps.clock.now());
  });
}

/**
 * Ligue publique : le créateur valide après la clôture des inscriptions (ou dès que la ligue
 * est complète), sous 48 h. La validation lance le tirage et le calendrier.
 */
export async function validateLeague(deps: LeagueDeps, actor: Actor, leagueId: string): Promise<void> {
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    if (league.creator_id !== actor.userId) throw new AppError('league.not_creator', 403);
    if (league.access !== 'public') throw wrongStatus(league);
    if (league.status === 'registration') {
      const n = (await loadMembers(tx, leagueId)).filter((m) => m.status === 'active').length;
      if (n < league.max_places) throw wrongStatus(league);
    } else if (league.status !== 'awaiting_validation') {
      throw wrongStatus(league);
    }
    await launch(tx, deps, league, deps.clock.now());
  });
}

/* ------------------------------------------------------------------ */
/* Annulation                                                           */

export type CancelReason = 'creator' | 'not_enough_players' | 'not_validated';

async function cancelInternal(tx: Transaction, deps: LeagueDeps, league: LeagueRow, reason: CancelReason, now: Date): Promise<void> {
  const members = await loadMembers(tx, league.id);
  if (league.status === 'running') {
    await takeBackBonus(tx, league.id, league.bonus);
    // Après validation : la caution du créateur est partagée entre les inscrits.
    const active = members.filter((m) => m.status === 'active').map((m) => m.user_id);
    if (league.access === 'public') await shareCaution(tx, league.id, cancelAfterValidation(league.caution, 0, active));
  } else {
    await returnCaution(tx, league.id, league.creator_id);
  }
  // Chacun récupère ce qu'il a mis au pot et pas encore récupéré (entrée, amendes).
  let pot = await potOf(tx, league.id);
  for (const m of members) {
    const due = Math.min(pot, Math.max(0, m.entry_paid - m.refunded) + m.fines_paid);
    if (due <= 0) continue;
    await refundFromPot(tx, league.id, m.user_id, due, `cancel:${m.user_id}`, 'cancelled');
    pot -= due;
  }
  await tx.query(`UPDATE league_matches SET status = 'cancelled' WHERE league_id = $1 AND status IN ('scheduled','playing')`, [league.id]);
  await tx.query(`UPDATE leagues SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3 WHERE id = $1`, [league.id, now, reason]);
  await notifyAll(
    deps,
    tx,
    [league.creator_id, ...members.map((m) => m.user_id)],
    'league.cancelled',
    { ...leagueParams(league), reason },
  );
}

export async function cancelLeague(deps: LeagueDeps, actor: Actor, leagueId: string): Promise<void> {
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    if (league.creator_id !== actor.userId) throw new AppError('league.not_creator', 403);
    if (league.status === 'finished' || league.status === 'cancelled') throw wrongStatus(league);
    await cancelInternal(tx, deps, league, 'creator', deps.clock.now());
  });
}

/** Tâche : clôture des inscriptions des ligues publiques, et validation manquée sous 48 h. */
export async function closeRegistrations(deps: LeagueDeps, now: Date): Promise<void> {
  const due = await deps.db.query<{ id: string }>(
    `SELECT id FROM leagues WHERE access = 'public' AND
       ((status = 'registration' AND registration_closes_at <= $1) OR (status = 'awaiting_validation' AND closed_at <= $2))`,
    [now, new Date(now.getTime() - 48 * HOUR)],
  );
  for (const { id } of due.rows) {
    await transaction(deps.db, async (tx) => {
      const league = await getLeague(tx, id, true);
      if (league.status === 'awaiting_validation') {
        if (league.closed_at && league.closed_at.getTime() <= now.getTime() - 48 * HOUR) await cancelInternal(tx, deps, league, 'not_validated', now);
        return;
      }
      if (league.status !== 'registration' || !league.registration_closes_at || league.registration_closes_at > now) return;
      const n = (await loadMembers(tx, id)).filter((m) => m.status === 'active').length;
      if (n < minimumPlayers(league)) {
        await cancelInternal(tx, deps, league, 'not_enough_players', now);
        return;
      }
      await tx.query(`UPDATE leagues SET status = 'awaiting_validation', closed_at = $2 WHERE id = $1`, [id, now]);
      await deps.notifications.notify(tx, league.creator_id, 'league.validate_due', { ...leagueParams(league), entrants: n });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Match du jour : heure, planche, présence                             */

function assertPlayer(match: MatchRow, userId: string): void {
  if (!match.players.includes(userId)) throw new AppError('league.not_in_match', 403);
}

export async function setMatchTime(deps: LeagueDeps, actor: Actor, leagueId: string, matchId: string, time: string): Promise<void> {
  const now = deps.clock.now();
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId);
    const match = await getMatch(tx, leagueId, matchId, true);
    assertPlayer(match, actor.userId);
    if (match.team_match_id) throw new AppError('league.team_match_fixed', 409);
    if (time !== league.default_time && !(LEAGUE_TIME_SLOTS as readonly string[]).includes(time)) throw new AppError('league.time_invalid', 400);
    const candidate = matchAtOf(match.day, time);
    if (match.status !== 'scheduled' || match.match_at.getTime() - now.getTime() < TIME_CHANGE_LIMIT_MS || candidate.getTime() - now.getTime() < TIME_CHANGE_LIMIT_MS) {
      throw new AppError('league.too_late', 409);
    }
    const proposals = { ...match.time_proposals, [actor.userId]: time };
    // Heure retenue : celle de tout le monde, sinon l'heure par défaut de la ligue.
    const agreed = match.players.every((p) => proposals[p] === time);
    const at = agreed ? candidate : matchAtOf(match.day, league.default_time);
    await tx.query(`UPDATE league_matches SET time_proposals = $2, time_agreed = $3, match_at = $4, reminders = '{}' WHERE id = $1`, [
      matchId,
      JSON.stringify(proposals),
      agreed,
      at,
    ]);
    for (const p of match.players) {
      if (p !== actor.userId) await deps.notifications.notify(tx, p, agreed ? 'league.time_agreed' : 'league.time_proposed', { ...leagueParams(league), matchId, time });
    }
  });
}

/** Qui choisit la planche de ce match (écran 34b). */
export function boardChooser(league: Pick<LeagueRow, 'board_rules'>, match: Pick<MatchRow, 'players' | 'stage'>, userId: string): 'organizer' | 'me' | 'opponent' | 'both' | 'calendar' {
  if (match.stage === 'decider') return 'organizer';
  switch (league.board_rules.policy) {
    case 'imposed':
      return 'organizer';
    case 'rotation':
      return 'calendar';
    case 'agreement':
      return 'both';
    case 'home':
      return match.players[0] === userId ? 'me' : 'opponent';
  }
}

export async function setMatchBoard(deps: LeagueDeps, actor: Actor, leagueId: string, matchId: string, board: LeagueBoard): Promise<void> {
  const now = deps.clock.now();
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId);
    const match = await getMatch(tx, leagueId, matchId, true);
    assertPlayer(match, actor.userId);
    const chooser = boardChooser(league, match, actor.userId);
    if (chooser !== 'me' && chooser !== 'both') throw new AppError('league.board_not_allowed', 403);
    if (!league.board_rules.allowed.includes(board)) throw new AppError('league.board_not_allowed', 400);
    if (match.status !== 'scheduled' || now.getTime() > match.match_at.getTime() - 24 * HOUR) throw new AppError('league.too_late', 409);
    const choices = { ...match.board_choices, [actor.userId]: { board, at: now.toISOString() } };
    await tx.query('UPDATE league_matches SET board_choices = $2 WHERE id = $1', [matchId, JSON.stringify(choices)]);
    for (const p of match.players) {
      if (p !== actor.userId) await deps.notifications.notify(tx, p, 'league.board_chosen', { ...leagueParams(league), matchId, board });
    }
  });
}

/** Planche du match à l'heure du match (règle de la ligue, choix faits jusqu'à 24 h avant). */
export function decideMatchBoard(league: Pick<LeagueRow, 'board_rules'>, match: MatchRow): Board {
  if (match.board) return match.board as Board;
  const rules = league.board_rules as BoardRules;
  const at = (id: string | undefined) => {
    const c = id ? match.board_choices[id] : undefined;
    return c ? { board: c.board as Board, at: Date.parse(c.at) } : null;
  };
  if (rules.policy === 'agreement' && match.players.length > 2) {
    // Table de Ludo : la planche de tout le monde, sinon celle par défaut.
    const choices = match.players.map((p) => at(p));
    const first = choices[0];
    const limit = match.match_at.getTime() - 24 * HOUR;
    if (first && choices.every((c) => c && c.board === first.board && c.at <= limit) && rules.allowed.includes(first.board)) return first.board;
    return rules.defaultBoard;
  }
  return decideBoard({
    rules,
    round: match.round,
    matchAt: match.match_at.getTime(),
    hostChoice: at(match.players[0]),
    proposals: [at(match.players[0]), at(match.players[1])],
  }).board;
}

/**
 * Démarre la partie du match avec les joueurs présents (service des parties en ligne, C3).
 * Renvoie false si le service n'est pas branché : la tâche réessaiera.
 */
async function startMatchGame(tx: Transaction, deps: LeagueDeps, league: LeagueRow, match: MatchRow, present: readonly string[]): Promise<boolean> {
  const port = leagueGames();
  if (!port) return false;
  const board = decideMatchBoard(league, match);
  const seats = match.players.filter((p) => present.includes(p)).map((userId) => ({ userId }));
  // Ludo par équipes : partenaires face à face quand les quatre sont là.
  const teams = league.team_size === 2 && seats.length === 4 ? LUDO_TEAM_SEATS : undefined;
  const { gameId } = await port.createGame(tx, {
    context: 'league',
    variant: board,
    seats,
    ...(teams ? { teams } : {}),
    clock: league.game === 'dames' ? (match.stage === 'decider' ? DECIDER_CLOCK : LEAGUE_CLOCK) : null,
    rated: boardIsRated(board),
    stake: 0,
    league: { leagueId: league.id, matchId: match.id },
  });
  await tx.query(`UPDATE league_matches SET status = 'playing', game_id = $2, board = $3 WHERE id = $1`, [match.id, gameId, board]);
  for (const s of seats) await deps.notifications.notify(tx, s.userId, 'league.match_ready', { ...leagueParams(league), matchId: match.id, gameId }, { push: 'always' });
  return true;
}

/** « Je suis là » : entrée dans la salle du match ; la partie démarre quand tout le monde est là. */
export async function arrive(deps: LeagueDeps, actor: Actor, leagueId: string, matchId: string): Promise<void> {
  const now = deps.clock.now();
  const started = await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    const match = await getMatch(tx, leagueId, matchId, true);
    assertPlayer(match, actor.userId);
    if (match.status === 'playing') return true;
    if (match.status !== 'scheduled') throw new AppError('league.too_late', 409);
    const t = now.getTime();
    if (t < match.match_at.getTime() - ROOM_OPENS_BEFORE_MS) throw new AppError('league.too_early', 409, { opensAt: new Date(match.match_at.getTime() - ROOM_OPENS_BEFORE_MS).toISOString() });
    if (t > match.match_at.getTime() + FORFEIT_GRACE_MS) throw new AppError('league.too_late', 409);
    const arrivals = { ...match.arrivals, [actor.userId]: match.arrivals[actor.userId] ?? now.toISOString() };
    await tx.query('UPDATE league_matches SET arrivals = $2 WHERE id = $1', [matchId, JSON.stringify(arrivals)]);
    if (!match.players.every((p) => arrivals[p])) return true;
    return startMatchGame(tx, deps, league, { ...match, arrivals }, match.players);
  });
  if (!started) throw new AppError('league.games_unavailable', 503);
}

/* ------------------------------------------------------------------ */
/* Résultats                                                            */

async function addFines(tx: Transaction, league: LeagueRow, matchId: string, absent: readonly string[]): Promise<void> {
  const fine = forfeitFine(league.entry);
  for (const id of absent) {
    const paid = await payFine(tx, league.id, id, fine, matchId);
    if (paid > 0) await tx.query('UPDATE league_members SET fines_paid = fines_paid + $3 WHERE league_id = $1 AND user_id = $2', [league.id, id, paid]);
  }
}

/** Partie terminée (événement du service des parties en ligne). Idempotent. */
export async function recordGameResult(deps: LeagueDeps, event: LeagueGameFinished): Promise<void> {
  if (event.context !== 'league' || !event.league) return;
  const { leagueId, matchId } = event.league;
  const now = deps.clock.now();
  await transaction(deps.db, async (tx) => {
    const league = await getLeague(tx, leagueId, true);
    const match = await getMatch(tx, leagueId, matchId, true);
    if (match.game_id !== event.gameId || match.status !== 'playing') return;
    const seatOf = new Map(event.seats.filter((s) => s.userId).map((s) => [s.userId!, s.seat]));
    const placeOf = (userId: string): number | null => {
      const seat = seatOf.get(userId);
      if (seat === undefined) return null;
      return event.outcome.places[String(seat)] ?? null;
    };
    if (league.game === 'dames') {
      const [home] = match.players as [string, string];
      const outcome: MatchOutcome = event.outcome.draw ? 'draw' : placeOf(home) === 1 ? 'home_win' : 'away_win';
      // Les blancs (siège 0) sont toujours le joueur qui reçoit.
      const diff = event.pieceDiff ?? null;
      await tx.query(`UPDATE league_matches SET status = 'played', outcome = $2, piece_diff = $3, played_at = $4 WHERE id = $1`, [matchId, outcome, diff, now]);
    } else {
      const results: LudoSeatResult[] = match.players.map((p) => {
        const seat = seatOf.get(p);
        return { playerId: p, place: placeOf(p), tokensHome: seat === undefined ? 0 : (event.tokensHome?.[String(seat)] ?? 0) };
      });
      await tx.query(`UPDATE league_matches SET status = 'played', results = $2, played_at = $3 WHERE id = $1`, [matchId, JSON.stringify(results), now]);
    }
    await afterResults(tx, deps, league.id, now);
  });
}

/** Absences à l'heure limite (10 min après l'heure du match) : forfaits, ou partie avec les présents. */
async function resolveMatch(tx: Transaction, deps: LeagueDeps, league: LeagueRow, match: MatchRow, now: Date): Promise<void> {
  const deadline = match.match_at.getTime() + FORFEIT_GRACE_MS;
  const here = (p: string) => {
    const a = match.arrivals[p];
    return a !== undefined && Date.parse(a) <= deadline;
  };
  if (league.game === 'dames') {
    const [home, away] = match.players as [string, string];
    const outcome = attendanceOutcome({
      matchAt: match.match_at.getTime(),
      now: now.getTime(),
      homeArrivedAt: here(home) ? Date.parse(match.arrivals[home]!) : null,
      awayArrivedAt: here(away) ? Date.parse(match.arrivals[away]!) : null,
    });
    if (outcome === null) return;
    if (outcome === 'play') {
      await startMatchGame(tx, deps, league, match, match.players);
      return;
    }
    await tx.query(`UPDATE league_matches SET status = 'played', outcome = $2, played_at = $3 WHERE id = $1`, [match.id, outcome, now]);
    const absent = forfeitedBy({ round: match.round, home, away, outcome });
    await addFines(tx, league, match.id, absent);
    for (const p of match.players) {
      await deps.notifications.notify(tx, p, 'league.forfeit', { ...leagueParams(league), matchId: match.id, absent: absent.includes(p), fine: forfeitFine(league.entry) });
    }
  } else {
    const present = match.players.filter(here);
    const absent = match.players.filter((p) => !present.includes(p));
    // Ludo par équipes (table [h1, a1, h2, a2]) : si une seule équipe est venue, pas de partie.
    const oneTeam = league.team_size === 2 && present.every((p) => match.players.indexOf(p) % 2 === match.players.indexOf(present[0]!) % 2);
    if (present.length >= 2 && !oneTeam) {
      // Les absents sont sortis de la table, qui joue sans eux ; ils comptent un forfait.
      if (absent.length > 0) await addFines(tx, league, match.id, absent);
      if (!(await startMatchGame(tx, deps, league, match, present))) return;
      for (const p of absent) await deps.notifications.notify(tx, p, 'league.forfeit', { ...leagueParams(league), matchId: match.id, absent: true, fine: forfeitFine(league.entry) });
      return;
    }
    const results: LudoSeatResult[] = match.players.map((p) => ({ playerId: p, place: present.includes(p) ? 1 : null, tokensHome: 0 }));
    await tx.query(`UPDATE league_matches SET status = 'played', results = $2, played_at = $3 WHERE id = $1`, [match.id, JSON.stringify(results), now]);
    await addFines(tx, league, match.id, absent);
    for (const p of match.players) {
      await deps.notifications.notify(tx, p, 'league.forfeit', { ...leagueParams(league), matchId: match.id, absent: absent.includes(p), fine: forfeitFine(league.entry) });
    }
  }
  await afterResults(tx, deps, league.id, now);
}

/** Tâche : matchs dont l'heure limite est passée. */
export async function resolveDueMatches(deps: LeagueDeps, now: Date): Promise<void> {
  const due = await deps.db.query<{ id: string; league_id: string }>(
    `SELECT m.id, m.league_id FROM league_matches m JOIN leagues l ON l.id = m.league_id
      WHERE l.status = 'running' AND m.status = 'scheduled' AND m.match_at <= $1 ORDER BY m.match_at`,
    [new Date(now.getTime() - FORFEIT_GRACE_MS)],
  );
  for (const row of due.rows) {
    try {
      await transaction(deps.db, async (tx) => {
        const league = await getLeague(tx, row.league_id, true);
        const match = await getMatch(tx, row.league_id, row.id, true);
        if (league.status !== 'running' || match.status !== 'scheduled') return;
        await resolveMatch(tx, deps, league, match, now);
      });
    } catch (err) {
      deps.log?.error({ err, matchId: row.id }, 'match de ligue non résolu');
    }
  }
  // Tout le monde est là mais le service des parties manquait : on réessaie.
  const waiting = await deps.db.query<{ id: string; league_id: string }>(
    `SELECT m.id, m.league_id FROM league_matches m JOIN leagues l ON l.id = m.league_id
      WHERE l.status = 'running' AND m.status = 'scheduled' AND m.match_at > $1 AND m.match_at <= $2`,
    [new Date(now.getTime() - FORFEIT_GRACE_MS), new Date(now.getTime() + ROOM_OPENS_BEFORE_MS)],
  );
  if (!leagueGames()) return;
  for (const row of waiting.rows) {
    await transaction(deps.db, async (tx) => {
      const league = await getLeague(tx, row.league_id, true);
      const match = await getMatch(tx, row.league_id, row.id, true);
      if (match.status === 'scheduled' && match.players.every((p) => match.arrivals[p])) await startMatchGame(tx, deps, league, match, match.players);
    });
  }
}

/** Tâche : rappels la veille, 1 h et 10 min avant (seul le plus proche part si la tâche est en retard). */
export async function sendReminders(deps: LeagueDeps, now: Date): Promise<void> {
  const r = await deps.db.query<{ id: string; league_id: string }>(
    `SELECT m.id, m.league_id FROM league_matches m JOIN leagues l ON l.id = m.league_id
      WHERE l.status = 'running' AND m.status = 'scheduled' AND m.match_at > $1 AND m.match_at <= $2
        AND NOT ('10m' = ANY(m.reminders))`,
    [now, new Date(now.getTime() + 24 * HOUR)],
  );
  const steps: { key: string; before: number }[] = [
    { key: '10m', before: 10 * 60_000 },
    { key: '1h', before: HOUR },
    { key: 'eve', before: 24 * HOUR },
  ];
  for (const row of r.rows) {
    await transaction(deps.db, async (tx) => {
      const league = await getLeague(tx, row.league_id);
      const match = await getMatch(tx, row.league_id, row.id, true);
      if (match.status !== 'scheduled') return;
      const left = match.match_at.getTime() - now.getTime();
      const step = steps.find((s) => left <= s.before);
      if (!step || match.reminders.includes(step.key)) return;
      // Les rappels plus lointains sont marqués envoyés : on ne les rattrape pas.
      const sent = steps.slice(steps.indexOf(step)).map((s) => s.key);
      await tx.query('UPDATE league_matches SET reminders = $2 WHERE id = $1', [match.id, [...new Set([...match.reminders, ...sent])]]);
      const names = await pseudosOf(tx, match.players);
      for (const p of match.players) {
        const others = match.players.filter((x) => x !== p);
        const params = {
          ...leagueParams(league),
          matchId: match.id,
          opponent: others.length === 1 ? names.get(others[0]!) ?? '' : '',
          players: others.length,
          at: match.match_at.toISOString(),
          minutes: Math.round(step.before / 60_000),
        };
        await deps.notifications.notify(tx, p, step.key === 'eve' ? 'league.match_tomorrow' : 'league.match_soon', params);
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Après un résultat : exclusions, coupe, clôture                       */

async function afterResults(tx: Transaction, deps: LeagueDeps, leagueId: string, now: Date): Promise<void> {
  const league = await getLeague(tx, leagueId, true);
  if (league.status !== 'running') return;
  // Exclusions : 2 forfaits de suite ou 3 au total (pas en ligue par équipes : l'équipe perd la planche).
  while (!league.team_size) {
    const members = await loadMembers(tx, leagueId);
    const matches = await loadMatches(tx, leagueId);
    const records = attendanceRecords(matches);
    const due = members.find((m) => m.status === 'active' && exclusionDue(m.user_id, records));
    if (!due) break;
    await excludePlayer(tx, deps, league, due, members, matches, now);
  }
  if (league.format === 'cup') await advanceCup(tx, deps, league, now);
  const left = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM league_matches WHERE league_id = $1 AND status IN ('scheduled','playing')`, [leagueId]);
  if ((left.rows[0]?.n ?? 0) === 0) await completeLeague(tx, deps, await getLeague(tx, leagueId, true), now);
}

/** Positions au classement (championnat) : userId → place. */
async function positions(tx: Transaction, league: LeagueRow): Promise<Map<string, number>> {
  const members = (await loadMembers(tx, league.id)).filter((m) => m.status === 'active');
  const matches = await loadMatches(tx, league.id);
  if (league.format === 'cup') {
    const out = new Map<string, number>();
    const byGroup = new Map<number, string[]>();
    for (const m of members) byGroup.set(m.group_index ?? 0, [...(byGroup.get(m.group_index ?? 0) ?? []), m.user_id]);
    for (const [g, ids] of byGroup) {
      for (const row of groupStandings(ids, damesRecords(matches, 'group', g), league.qualifiers_per_group ?? 2, { draw: drawOrder(members) }).rows) out.set(row.playerId, row.position);
    }
    return out;
  }
  return new Map(championshipRanking(league, members, matches).rows.map((r) => [r.playerId, r.position]));
}

interface ExclusionChange {
  userId: string;
  round: number;
  result: 'win' | 'draw' | 'loss' | 'forfeit_win' | 'awarded';
  points: number;
}

/** Exclusion d'un joueur (écran 35) : résultats, calendrier, argent, notifications. */
async function excludePlayer(
  tx: Transaction,
  deps: LeagueDeps,
  league: LeagueRow,
  member: MemberRow,
  members: readonly MemberRow[],
  matches: readonly MatchRow[],
  now: Date,
): Promise<void> {
  const userId = member.user_id;
  const before = await positions(tx, league);
  const today = dayKey(now.getTime());
  const involves = (m: MatchRow) => m.players.includes(userId);
  const mine = matches.filter((m) => involves(m) && m.status !== 'cancelled' && m.status !== 'annulled');
  const forfeitRounds = attendanceRecords(mine)
    .filter((r) => forfeitedBy(r).includes(userId))
    .map((r) => r.round)
    .sort((a, b) => a - b);
  const consecutive = forfeitRounds.length < 3;
  const endBefore = maxDay(matches);

  let policy: 'annulled' | 'kept' = 'kept';
  let elapsed: number;
  let totalMatches: number;
  const changes: ExclusionChange[] = [];
  let calendar: { mode: 'bye' | 'repacked'; rested: { round: number; userId: string }[]; changedFor: string[] } = { mode: 'bye', rested: [], changedFor: [] };

  if (league.game === 'dames' && league.format === 'championship') {
    // Règle de la planche RegleLigues : moins de la moitié joués → tout est annulé.
    const n = members.length;
    totalMatches = matchesPerPlayer(n, league.double_round);
    const records = damesRecords(matches);
    const unplayedRows = matches.filter((m) => m.stage === 'league' && m.status === 'scheduled');
    const result = applyExclusion({ excluded: userId, matches: records, unplayed: asFixtures(unplayedRows), totalMatches, entry: league.entry });
    policy = result.policy;
    elapsed = result.elapsed;
    if (policy === 'annulled') {
      for (const rec of result.annulled) {
        const pts = matchPoints(rec);
        const oppHome = rec.away === userId;
        const opp = oppHome ? rec.home : rec.away;
        const side = oppHome ? pts.home : pts.away;
        const excludedForfeited = forfeitedBy(rec).includes(userId);
        changes.push({
          userId: opp,
          round: rec.round,
          result: excludedForfeited && side.win ? 'forfeit_win' : side.win ? 'win' : side.draw ? 'draw' : 'loss',
          points: -(side.points - side.penalty),
        });
      }
      await tx.query(`UPDATE league_matches SET status = 'annulled' WHERE league_id = $1 AND stage = 'league' AND status = 'played' AND $2::uuid = ANY(players)`, [
        league.id,
        userId,
      ]);
      await tx.query(`UPDATE league_matches SET status = 'cancelled' WHERE league_id = $1 AND status = 'scheduled' AND $2::uuid = ANY(players)`, [league.id, userId]);
    } else {
      for (const m of unplayedRows.filter(involves)) {
        const outcome: MatchOutcome = m.players[0] === userId ? 'away_awarded' : 'home_awarded';
        await tx.query(`UPDATE league_matches SET status = 'played', outcome = $2, played_at = $3 WHERE id = $1`, [m.id, outcome, now]);
        changes.push({ userId: m.players[0] === userId ? m.players[1]! : m.players[0]!, round: m.round, result: 'awarded', points: 3 });
      }
    }
    // Calendrier : un seul exclu, son adversaire se repose ; deux ou plus, on range à nouveau.
    const excludedSoFar = members.filter((m) => m.status === 'excluded').map((m) => m.user_id);
    const rest = unplayedRows.filter((m) => !involves(m));
    if (excludedSoFar.length === 0) {
      calendar = {
        mode: 'bye',
        rested: withExcludedAsBye(asFixtures(unplayedRows), userId).rested.map((r) => ({ round: r.round, userId: r.player })),
        changedFor: [],
      };
      calendar.changedFor = calendar.rested.map((r) => r.userId);
    } else {
      const present = members.filter((m) => m.status === 'active' && m.user_id !== userId).map((m) => m.user_id);
      const movable = rest.filter((m) => m.day > today);
      const fromRound = movable.length ? Math.min(...movable.map((m) => m.round)) : null;
      if (fromRound !== null) {
        const packed = packFixtures(asFixtures(movable), present, fromRound);
        const pool = [...movable];
        const changed = new Set<string>();
        for (const f of packed) {
          const i = pool.findIndex((m) => m.players[0] === f.home && m.players[1] === f.away);
          const row = pool.splice(i, 1)[0]!;
          if (row.round === f.round) continue;
          const day = dayOfRound(league, f.round);
          await tx.query(
            `UPDATE league_matches SET round = $2, day = $3, match_at = $4, time_proposals = '{}', time_agreed = false, board_choices = '{}', reminders = '{}'
              WHERE id = $1`,
            [row.id, f.round, day, matchAtOf(day, league.default_time)],
          );
          changed.add(f.home).add(f.away);
        }
        calendar = { mode: 'repacked', rested: [], changedFor: [...changed] };
      } else {
        calendar = { mode: 'repacked', rested: [], changedFor: [] };
      }
    }
  } else {
    // Ludo et coupe : les résultats restent ; les matchs à venir de l'exclu sont donnés à ses adversaires
    // (coupe) ou il quitte les tables à venir (Ludo).
    totalMatches = mine.length;
    elapsed = mine.filter((m) => m.status === 'played').length;
    const future = mine.filter((m) => m.status === 'scheduled');
    if (league.game === 'ludo') {
      const futureRounds = [...new Set(matches.filter((m) => m.status === 'scheduled' && m.day > today).map((m) => m.round))].sort((a, b) => a - b);
      // Tables du jour : il en sort, la table joue sans lui.
      for (const m of future.filter((x) => x.day <= today)) {
        await tx.query(`UPDATE league_matches SET players = array_remove(players, $2::uuid) WHERE id = $1`, [m.id, userId]);
      }
      if (futureRounds.length > 0) {
        await tx.query(`DELETE FROM league_matches WHERE league_id = $1 AND status = 'scheduled' AND round = ANY($2::smallint[])`, [league.id, futureRounds]);
        const present = members.filter((m) => m.status === 'active' && m.user_id !== userId);
        const order = present.sort((a, b) => (a.draw_order ?? 0) - (b.draw_order ?? 0)).map((m) => m.user_id);
        const past = matches.filter((m) => !futureRounds.includes(m.round)).map((m) => m.players);
        await insertMatches(tx, league, ludoFixtures(order, futureRounds.length, ludoTableSize(league), league.draw_seed ?? league.id, past, futureRounds[0]));
        calendar = { mode: 'repacked', rested: [], changedFor: order };
      }
    } else {
      for (const m of future) {
        const outcome: MatchOutcome = m.players[0] === userId ? 'away_awarded' : 'home_awarded';
        await tx.query(`UPDATE league_matches SET status = 'played', outcome = $2, played_at = $3 WHERE id = $1`, [m.id, outcome, now]);
        changes.push({ userId: m.players[0] === userId ? m.players[1]! : m.players[0]!, round: m.round, result: 'awarded', points: 3 });
      }
    }
  }

  // Argent : ½ × entrée × restants ÷ totaux rendu à l'exclu ; le reste et ses amendes restent au pot.
  const remaining = Math.max(0, totalMatches - elapsed);
  const refund = totalMatches > 0 ? Math.floor((league.entry * remaining) / (2 * totalMatches)) : 0;
  const potNow = await potOf(tx, league.id);
  await refundFromPot(tx, league.id, userId, Math.min(refund, potNow), `exclusion:${userId}`, 'exclusion');
  await tx.query(`UPDATE league_members SET status = 'excluded', excluded_at = $3, refunded = refunded + $4 WHERE league_id = $1 AND user_id = $2`, [
    league.id,
    userId,
    now,
    Math.min(refund, potNow),
  ]);

  const after = await positions(tx, league);
  const positionsMap: Record<string, { before: number; after: number }> = {};
  for (const [id, a] of after) {
    const b = before.get(id);
    if (b !== undefined) positionsMap[id] = { before: b, after: a };
  }
  const left = await loadMatches(tx, league.id);
  const remainingMatches = left.filter((m) => m.status === 'scheduled').length;
  const nextRounds = new Set(left.filter((m) => m.status === 'scheduled').map((m) => m.round));
  const details = {
    forfeitRounds,
    reason: consecutive ? 'consecutive' : 'total',
    policy,
    elapsed,
    totalMatches,
    remainingPlayers: members.filter((m) => m.status === 'active' && m.user_id !== userId).length,
    changes,
    positions: positionsMap,
    calendar: {
      ...calendar,
      remainingMatches,
      matchesPerRound: nextRounds.size ? Math.round(remainingMatches / nextRounds.size) : 0,
      endDayBefore: endBefore,
      endDayAfter: maxDay(left),
    },
    money: { refund: Math.min(refund, potNow), remaining: Math.max(0, member.entry_paid - Math.min(refund, potNow)), fines: member.fines_paid, potBefore: potNow - member.fines_paid, potAfter: potNow - Math.min(refund, potNow) },
  };
  const round = Math.max(0, ...mine.filter((m) => m.status === 'played').map((m) => m.round));
  await tx.query(`INSERT INTO league_exclusions (league_id, user_id, round, details, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [
    league.id,
    userId,
    round,
    JSON.stringify(details),
    now,
  ]);
  await deps.notifications.notify(tx, userId, 'league.excluded', { ...leagueParams(league), refund: details.money.refund });
  for (const [id, p] of Object.entries(positionsMap)) {
    await deps.notifications.notify(tx, id, 'league.player_excluded', { ...leagueParams(league), excluded: userId, pseudo: member.pseudo, before: p.before, after: p.after });
  }
}

function maxDay(matches: readonly MatchRow[]): string {
  const days = matches.filter((m) => m.status !== 'cancelled' && m.status !== 'annulled').map((m) => m.day);
  return days.length ? days.reduce((a, b) => (a > b ? a : b)) : '';
}

/* ------------------------------------------------------------------ */
/* Coupe : phase finale                                                 */

/** Résultat d'un match de coupe vu de la rencontre (first = qui reçoit à l'aller). */
function legResult(m: MatchRow, tie: Tie): GameResult | null {
  if (m.status !== 'played' || !m.outcome) return null;
  const [home, away] = m.players as [string, string];
  let winner: string | null;
  switch (m.outcome) {
    case 'home_win':
    case 'away_forfeit':
    case 'home_awarded':
      winner = home;
      break;
    case 'away_win':
    case 'home_forfeit':
    case 'away_awarded':
      winner = away;
      break;
    default:
      winner = null; // nulle, ou double forfait (compté comme une nulle)
  }
  if (winner === null) return 'draw';
  return winner === tie.first ? 'first' : 'second';
}

interface TieState {
  tie: Tie;
  index: number;
  level: number;
  legs: MatchRow[];
  deciders: MatchRow[];
}

export function tiesOf(matches: readonly MatchRow[]): TieState[] {
  const ties = new Map<string, TieState>();
  for (const m of matches) {
    if ((m.stage !== 'knockout' && m.stage !== 'decider') || m.level === null || m.tie_index === null) continue;
    const key = `${m.level}:${m.tie_index}`;
    let t = ties.get(key);
    if (!t) {
      t = { tie: { first: '', second: '' }, index: m.tie_index, level: m.level, legs: [], deciders: [] };
      ties.set(key, t);
    }
    if (m.stage === 'knockout') t.legs.push(m);
    else t.deciders.push(m);
  }
  for (const t of ties.values()) {
    t.legs.sort((a, b) => (a.leg ?? 0) - (b.leg ?? 0));
    t.deciders.sort((a, b) => a.round - b.round);
    const leg1 = t.legs[0];
    if (leg1) t.tie = { first: leg1.players[0]!, second: leg1.players[1]! };
  }
  return [...ties.values()].sort((a, b) => a.level - b.level || a.index - b.index);
}

export function tieOutcome(t: TieState) {
  const [l1, l2] = t.legs;
  const r1 = l1 ? legResult(l1, t.tie) : null;
  const r2 = l2 ? legResult(l2, t.tie) : null;
  const deciders = t.deciders.map((d) => legResult(d, t.tie)).filter((r): r is GameResult => r !== null);
  return twoLegTie(t.tie, r1, r2, deciders);
}

async function createTies(tx: Transaction, league: LeagueRow, ties: readonly Tie[], level: number, fromRound: number): Promise<void> {
  const planned: PlannedMatch[] = [];
  ties.forEach((t, i) => {
    planned.push({ stage: 'knockout', round: fromRound, level, tie: i, leg: 1, players: [t.first, t.second] });
    planned.push({ stage: 'knockout', round: fromRound + 1, level, tie: i, leg: 2, players: [t.second, t.first] });
  });
  await insertMatches(tx, league, planned);
}

async function advanceCup(tx: Transaction, deps: LeagueDeps, league: LeagueRow, now: Date): Promise<void> {
  const matches = await loadMatches(tx, league.id);
  const open = (m: MatchRow) => m.status === 'scheduled' || m.status === 'playing';
  if (matches.some((m) => m.stage === 'group' && open(m))) return;
  const lastRound = Math.max(0, ...matches.filter((m) => m.status !== 'cancelled').map((m) => m.round));
  const ties = tiesOf(matches);
  const members = await loadMembers(tx, league.id);
  const active = members.filter((m) => m.status === 'active');

  if (ties.length === 0) {
    // Fin des poules : qualifiés (manche décisive remplacée par le tirage au sort en V1).
    const groups = league.groups ?? 1;
    const q = league.qualifiers_per_group ?? 2;
    const qualified: string[][] = [];
    for (let g = 0; g < groups; g++) {
      const ids = active.filter((m) => m.group_index === g).map((m) => m.user_id);
      const ranking = groupStandings(ids, damesRecords(matches, 'group', g), q, { draw: drawOrder(members), playoffOrder: drawOrder(members) });
      qualified.push(groupQualifiers(ranking, q));
    }
    if (qualified.some((list) => list.length < q)) return; // poule vidée par des exclusions : on clôture sur les poules
    const pairs = groups === 1 ? [{ first: qualified[0]![1]!, second: qualified[0]![0]! }] : knockoutPairs(qualified);
    await createTies(tx, league, pairs, 1, lastRound + 1);
    await notifyAll(deps, tx, pairs.flatMap((p) => [p.first, p.second]), 'league.knockout_started', leagueParams(league));
    return;
  }

  const level = Math.max(...ties.map((t) => t.level));
  const current = ties.filter((t) => t.level === level);
  if (current.some((t) => [...t.legs, ...t.deciders].some(open))) return;
  const winners: string[] = [];
  let created = false;
  for (const t of current) {
    const o = tieOutcome(t);
    if (o.winner) {
      winners.push(o.winner);
      continue;
    }
    if (!o.deciderNeeded) return;
    // Égalité : manche décisive de 5 minutes sur la planche de l'aller, couleurs alternées.
    const white = deciderWhite(t.tie, t.deciders.length);
    const black = white === t.tie.first ? t.tie.second : t.tie.first;
    await insertMatches(tx, league, [
      { stage: 'decider', round: lastRound + 1, level, tie: t.index, players: [white, black], board: t.legs[0]?.board ?? league.board_rules.defaultBoard },
    ]);
    created = true;
  }
  if (created || winners.length !== current.length) return;
  if (winners.length === 1) return; // finale jouée : la clôture suit (plus aucun match ouvert)
  await createTies(tx, league, nextRoundPairs(winners), level + 1, lastRound + 1);
}

/** Classement final d'une coupe : vainqueur, finaliste, puis les autres selon le tour atteint et les poules. */
async function cupRanking(tx: Transaction, league: LeagueRow): Promise<string[]> {
  const matches = await loadMatches(tx, league.id);
  const members = (await loadMembers(tx, league.id)).filter((m) => m.status === 'active');
  const ties = tiesOf(matches);
  const reached = new Map<string, number>();
  for (const t of ties) for (const p of [t.tie.first, t.tie.second]) reached.set(p, Math.max(reached.get(p) ?? 0, t.level));
  const final = ties.filter((t) => t.level === Math.max(0, ...ties.map((x) => x.level)));
  const champion = final.length === 1 ? tieOutcome(final[0]!).winner : null;
  const groupPos = await positions(tx, league);
  const ids = members.map((m) => m.user_id);
  return ids.sort((a, b) => {
    if (a === champion) return -1;
    if (b === champion) return 1;
    const ra = reached.get(a) ?? 0;
    const rb = reached.get(b) ?? 0;
    if (ra !== rb) return rb - ra;
    return (groupPos.get(a) ?? 99) - (groupPos.get(b) ?? 99);
  });
}

/* ------------------------------------------------------------------ */
/* Clôture                                                              */

async function completeLeague(tx: Transaction, deps: LeagueDeps, league: LeagueRow, now: Date): Promise<void> {
  if (league.status !== 'running') return;
  if (league.team_size) {
    await completeTeamLeague(tx, deps, league, now);
    return;
  }
  const members = await loadMembers(tx, league.id);
  const active = members.filter((m) => m.status === 'active');
  if (active.length === 0) {
    await cancelInternal(tx, deps, league, 'creator', now);
    return;
  }
  const matches = await loadMatches(tx, league.id);
  const ranking = league.format === 'cup' ? await cupRanking(tx, league) : championshipRanking(league, active, matches).rows.map((r) => r.playerId);
  const pot = await potOf(tx, league.id);
  if (pot > 0) {
    if (league.access === 'public') {
      const forfeits = forfeitCounts(matches);
      const finishers = active.filter((m) => (forfeits.get(m.user_id) ?? 0) === 0).map((m) => m.user_id);
      await payOut(tx, league.id, splitPot({ pot, ranking, finishers, creatorId: league.creator_id }).payouts);
    } else {
      await payOut(tx, league.id, splitPrivatePot(pot, ranking[0]!));
    }
  }
  await returnCaution(tx, league.id, league.creator_id);
  const kinds = ['or', 'argent', 'bronze'] as const;
  for (const [i, kind] of kinds.entries()) {
    const id = ranking[i];
    if (!id) continue;
    await tx.query(`INSERT INTO medals (user_id, league_id, kind, title, awarded_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, league_id) DO NOTHING`, [
      id,
      league.id,
      kind,
      league.name,
      now,
    ]);
  }
  const champion = ranking[0]!;
  const isMember = await tx.query<{ kind: string }>('SELECT kind FROM users WHERE id = $1', [champion]);
  if (isMember.rows[0]?.kind === 'member') await grantItem(tx, champion, TROPHY_CARD, 'reward');
  await tx.query(`UPDATE leagues SET status = 'finished', finished_at = $2 WHERE id = $1`, [league.id, now]);
  for (const [i, id] of ranking.entries()) {
    await deps.notifications.notify(tx, id, 'league.finished', { ...leagueParams(league), position: i + 1 });
  }
}

export const _internal = { tiesOf, tieOutcome, positions };
