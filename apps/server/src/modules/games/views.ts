/**
 * Lectures des parties en ligne : résumé et rejeu (GET /v1/games/:id, C3), preuve du dé
 * (écran 22), parties en direct (/regarder, accueil) et mes parties en cours.
 */
import { levelFromRating } from '@kwatt/domain';
import type { DiceProof, GameSeat, GameSummary, LiveGame, MachineSettlementView } from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import type { MediaStore } from '../media/store.js';
import { loadLooks } from '../profiles/look.js';
import type { GameActor } from './actor.js';
import { familyOf } from './engine.js';
import type { GameRulesConfig } from './store.js';

interface SummaryRow {
  id: string;
  context: GameSummary['context'];
  variant: string;
  status: GameSummary['status'];
  rules: GameRulesConfig;
  stake_per_player: number;
  end_reason: string | null;
  rng_commitment: Buffer | null;
  rng_server_seed: Buffer | null;
  started_at: Date | null;
  ended_at: Date | null;
  room_id: string | null;
}

async function seatsOf(db: Sql, media: MediaStore, gameId: string, rules: GameRulesConfig, viewerId: string | null): Promise<{ seats: GameSeat[]; rows: { seat: number; place: number | null; result: string | null; staking: boolean; userId: string | null }[] }> {
  const r = await db.query<{ seat: number; user_id: string | null; display_name: string; team: number | null; place: number | null; result: string | null; staking: boolean; pseudo: string | null }>(
    `SELECT gp.seat, gp.user_id, gp.display_name, gp.team, gp.place, gp.result, gp.staking, p.pseudo::text AS pseudo
       FROM game_players gp LEFT JOIN profiles p ON p.user_id = gp.user_id
      WHERE gp.game_id = $1 ORDER BY gp.seat`,
    [gameId],
  );
  const looks = await loadLooks(db, media, r.rows.map((x) => x.user_id).filter((x): x is string => !!x), viewerId);
  return {
    seats: r.rows.map((s) => ({
      seat: s.seat,
      userId: s.user_id,
      pseudo: s.pseudo ?? s.display_name,
      avatar: s.user_id ? (looks.get(s.user_id) ?? null) : null,
      ...(s.user_id === null && rules.machine ? { machine: { difficulty: rules.machine.difficulty } } : {}),
      ...(s.team !== null ? { team: s.team } : {}),
    })),
    rows: r.rows.map((s) => ({ seat: s.seat, place: s.place, result: s.result, staking: s.staking, userId: s.user_id })),
  };
}

/** GET /v1/games/:id → résumé et rejeu (contrat C3). */
export async function gameSummary(db: Sql, media: MediaStore, gameId: string, viewerId: string | null): Promise<GameSummary> {
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) throw new AppError('game.not_found', 404);
  const g = await db.query<SummaryRow>(
    `SELECT id, context, variant::text AS variant, status, rules, stake_per_player, end_reason, rng_commitment, rng_server_seed,
            started_at, ended_at, room_id
       FROM games WHERE id = $1`,
    [gameId],
  );
  const row = g.rows[0];
  if (!row) throw new AppError('game.not_found', 404);
  const { seats, rows } = await seatsOf(db, media, gameId, row.rules, viewerId);
  const moves = await db.query<{ n: string | null }>(`SELECT payload->>'n' AS n FROM moves WHERE game_id = $1 ORDER BY ply`, [gameId]);
  const finished = row.status === 'finished' || row.status === 'aborted';
  const draw = finished && rows.length > 0 && rows.every((x) => x.result === 'draw');
  const outcome: GameSummary['outcome'] = finished
    ? {
        places: Object.fromEntries(rows.map((x) => [String(x.seat), draw ? 1 : (x.place ?? rows.length)])),
        draw,
        reason: row.end_reason ?? 'normal',
      }
    : null;
  const ratings = await db.query<{ user_id: string; before: number; after: number }>('SELECT user_id, before, after FROM rating_history WHERE game_id = $1', [gameId]);
  const ratingChanges = Object.fromEntries(
    ratings.rows.map((x) => [x.user_id, { before: x.before, after: x.after, delta: x.after - x.before, levelBefore: levelFromRating(x.before), levelAfter: levelFromRating(x.after) }]),
  );
  const stakers = rows.filter((x) => x.staking).length;
  const summary: GameSummary = {
    id: row.id,
    family: familyOf(row.variant),
    variant: row.variant,
    context: row.context,
    status: row.status,
    seats,
    moves: moves.rows.map((m) => m.n ?? ''),
    outcome,
    stake: row.stake_per_player,
    pot: stakers >= 2 ? row.stake_per_player * stakers : 0,
    ratingChanges,
    house: row.rules.house ?? null,
    teams: row.rules.teams ?? null,
    clock: row.rules.clock ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
  };
  if (row.context === 'machine' && viewerId) {
    const s = await db.query<{ response: { settlement?: MachineSettlementView } }>('SELECT response FROM machine_results WHERE game_id = $1 AND user_id = $2', [gameId, viewerId]);
    const settlement = s.rows[0]?.response.settlement;
    if (settlement) summary.settlement = settlement;
  }
  if (row.rules.room) {
    const room = await db.query<{ code: string; format: 'simple' | 'aller_retour' | 'roi' }>('SELECT code, format FROM rooms WHERE id = $1', [row.rules.room.roomId]);
    const next = await db.query<{ user_id: string; pseudo: string }>(
      `SELECT m.user_id, COALESCE(p.pseudo::text, u.display_name, '?') AS pseudo
         FROM room_members m JOIN users u ON u.id = m.user_id LEFT JOIN profiles p ON p.user_id = m.user_id
        WHERE m.room_id = $1 AND m.role = 'queue' AND m.left_at IS NULL ORDER BY m.queue_pos LIMIT 1`,
      [row.rules.room.roomId],
    );
    const r = room.rows[0];
    if (r) {
      summary.room = {
        code: r.code,
        format: r.format,
        ...(next.rows[0] ? { nextChallenger: { userId: next.rows[0].user_id, pseudo: next.rows[0].pseudo } } : {}),
        ...(row.rules.room.leg ? { leg: row.rules.room.leg } : {}),
      };
    }
  }
  if (row.rules.league) summary.league = row.rules.league;
  if (row.rng_commitment) summary.dice = { commitment: row.rng_commitment.toString('hex'), revealed: row.rng_server_seed !== null };
  return summary;
}

/** GET /v1/games/:id/dice → preuve du dé (écran 22). Le secret n'est publié qu'à la fin. */
export async function diceProof(db: Sql, gameId: string): Promise<DiceProof> {
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) throw new AppError('game.not_found', 404);
  const g = await db.query<{ variant: string; rng_commitment: Buffer | null; rng_server_seed: Buffer | null; rules: GameRulesConfig }>(
    'SELECT variant::text AS variant, rng_commitment, rng_server_seed, rules FROM games WHERE id = $1',
    [gameId],
  );
  const row = g.rows[0];
  if (!row || !row.rng_commitment) throw new AppError('game.not_found', 404);
  const players = await db.query<{ seat: number; user_id: string | null }>('SELECT seat, user_id FROM game_players WHERE game_id = $1', [gameId]);
  const human = new Map(players.rows.map((p) => [p.seat, p.user_id !== null]));
  // Lancers joués par la machine (siège machine, ou tour joué à la place d'un absent).
  const auto = await db.query<{ roll_index: number }>(`SELECT roll_index FROM moves WHERE game_id = $1 AND roll_index IS NOT NULL AND played_by <> 'human'`, [gameId]);
  const byMachine = new Set(auto.rows.map((x) => x.roll_index));
  const rolls = await db.query<{ roll_index: number; seat: number; client_seed: Buffer; value: number }>(
    'SELECT roll_index, seat, client_seed, value FROM dice_rolls WHERE game_id = $1 ORDER BY roll_index',
    [gameId],
  );
  const cowries = row.variant === 'ludo_pachisi';
  return {
    gameId,
    kind: cowries ? 'cowries' : 'die',
    commitment: row.rng_commitment.toString('hex'),
    serverSeed: row.rng_server_seed ? row.rng_server_seed.toString('hex') : null,
    rolls: rolls.rows.map((r) => ({
      rollIndex: r.roll_index,
      seat: r.seat,
      clientSeed: r.client_seed.toString('hex'),
      value: r.value,
      byMachine: !human.get(r.seat) || byMachine.has(r.roll_index),
    })),
  };
}

/** Vue d'une partie en direct (acteur en mémoire). */
export async function liveGameOf(db: Sql, media: MediaStore, actor: GameActor, viewerId: string | null): Promise<LiveGame> {
  const cfg = actor.config;
  const ids = cfg.seats.map((s) => s.userId).filter((x): x is string => !!x);
  const looks = await loadLooks(db, media, ids, viewerId);
  const names = await db.query<{ id: string; pseudo: string }>(
    `SELECT u.id, COALESCE(p.pseudo::text, u.display_name, '?') AS pseudo FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ANY($1::uuid[])`,
    [ids],
  );
  const pseudo = new Map(names.rows.map((x) => [x.id, x.pseudo]));
  let room: LiveGame['room'];
  if (cfg.rules.room) {
    const r = await db.query<{ code: string; name: string }>('SELECT code, name FROM rooms WHERE id = $1', [cfg.rules.room.roomId]);
    if (r.rows[0]) room = r.rows[0];
  }
  let league: LiveGame['league'];
  if (cfg.rules.league) {
    const l = await db.query<{ name: string }>('SELECT name FROM leagues WHERE id = $1', [cfg.rules.league.leagueId]);
    league = { leagueId: cfg.rules.league.leagueId, name: l.rows[0]?.name ?? '' };
  }
  return {
    id: cfg.id,
    family: cfg.family,
    variant: cfg.variant,
    context: cfg.context,
    seats: cfg.seats.map((s) => ({
      seat: s.seat,
      userId: s.userId,
      pseudo: s.userId ? (pseudo.get(s.userId) ?? s.name) : s.name,
      avatar: s.userId ? (looks.get(s.userId) ?? null) : null,
      ...(s.machine ? { machine: s.machine } : {}),
      ...(s.team !== undefined ? { team: s.team } : {}),
    })),
    progress: actor.progress(),
    spectators: actor.spectatorCount(),
    stake: cfg.stake,
    ...(room ? { room } : {}),
    ...(league ? { league } : {}),
    startedAt: cfg.startedAt.toISOString(),
  };
}
