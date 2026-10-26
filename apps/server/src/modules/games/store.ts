/**
 * Écritures et lectures des parties en ligne (tables de 0001 et 0040). Règle « le serveur fait
 * foi » : chaque coup et chaque lancer est écrit ici AVANT d'être diffusé ; la reprise après
 * un redémarrage relit ces lignes et rejoue la partie.
 */
import { createHash } from 'node:crypto';
import { commitment, createServerSeed } from '@kwatt/fair-dice';
import type { Sql } from '../../db/pool.js';
import { familyOf, type Family, type Outcome } from './engine.js';

export type GameContext = 'machine' | 'room' | 'league';

export interface SeatConfig {
  seat: number;
  /** null : la machine. */
  userId: string | null;
  name: string;
  /** Siège machine : sa difficulté. */
  machine?: { difficulty: string } | undefined;
  team?: number | undefined;
  /** Mise bloquée sur le séquestre de la partie. */
  staking: boolean;
  guest: boolean;
}

export interface MachineConfig {
  /** Le joueur humain (siège 0). */
  userId: string;
  difficulty: 'facile' | 'moyen' | 'coriace' | 'ton_niveau' | 'fon';
  mode: 'auto' | 'chosen';
  bet: number;
  oddsHundredths: number;
  machineRating: number;
  seed: number;
  machines: number;
}

/** Ce qui est gardé dans `games.rules` (jsonb) : tout ce qu'il faut pour rejouer la partie. */
export interface GameRulesConfig {
  clock: { initialMs: number; incrementMs: number } | null;
  /** Ludo : temps par tour d'un humain (ms) ; null contre la machine (pas de limite). */
  turnMs: number | null;
  players: number;
  teams: number[][] | null;
  house: Record<string, string> | null;
  machine: MachineConfig | null;
  league: { leagueId: string; matchId: string } | null;
  room: { roomId: string; code: string; leg: 1 | 2 | null } | null;
  /** Absence : 60 s pour revenir (salons, ligues) ; contre la machine : on reprend plus tard. */
  absence: boolean;
}

export interface GameConfig {
  id: string;
  context: GameContext;
  family: Family;
  variant: string;
  ranked: boolean;
  stake: number;
  seats: SeatConfig[];
  rules: GameRulesConfig;
  startedAt: Date;
  listed: boolean;
}

export const RULES_VERSION = 'online-1';

export function stateHash(state: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(state)).digest();
}

export interface NewGameInput {
  context: GameContext;
  variant: string;
  ranked: boolean;
  stake: number;
  seats: Omit<SeatConfig, 'seat'>[];
  rules: GameRulesConfig;
  roomId?: string | null;
  startedAt: Date;
  listed: boolean;
}

/** Crée la partie (statut `playing`), ses sièges et l'engagement du dé (Ludo). */
export async function insertGame(db: Sql, input: NewGameInput): Promise<GameConfig> {
  const family = familyOf(input.variant);
  const secret = family === 'ludo' ? Buffer.from(createServerSeed()) : null;
  const r = await db.query<{ id: string }>(
    `INSERT INTO games (context, room_id, variant, rules, rules_version, ranked, stake_per_player, status,
                        rng_commitment, rng_secret, started_at, listed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'playing', $8, $9, $10, $11) RETURNING id`,
    [
      input.context,
      input.roomId ?? null,
      input.variant,
      JSON.stringify(input.rules),
      RULES_VERSION,
      input.ranked,
      input.stake,
      secret ? Buffer.from(commitment(secret), 'hex') : null,
      secret,
      input.startedAt.toISOString(),
      input.listed,
    ],
  );
  const id = r.rows[0]!.id;
  const seats = input.seats.map((s, seat) => ({ ...s, seat }));
  for (const s of seats) {
    await db.query(
      `INSERT INTO game_players (game_id, seat, user_id, display_name, color, team, staking) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, s.seat, s.userId, s.name, family === 'dames' ? (s.seat === 0 ? 'w' : 'b') : String(s.seat), s.team ?? null, s.staking],
    );
  }
  return { id, context: input.context, family, variant: input.variant, ranked: input.ranked, stake: input.stake, seats, rules: input.rules, startedAt: input.startedAt, listed: input.listed };
}

interface GameRow {
  id: string;
  context: GameContext;
  variant: string;
  rules: GameRulesConfig;
  ranked: boolean;
  stake_per_player: number;
  status: string;
  started_at: Date | null;
  created_at: Date;
  listed: boolean;
  rng_secret: Buffer | null;
}

export interface StoredMove {
  ply: number;
  seat: number;
  kind: string;
  rollIndex: number | null;
  notation: string | null;
  clockMs: number | null;
  playedBy: string;
  at: Date;
}

export interface StoredRoll {
  rollIndex: number;
  seat: number;
  clientSeed: Buffer;
  value: number;
}

export interface LoadedGame {
  config: GameConfig;
  status: string;
  secret: Uint8Array | null;
  moves: StoredMove[];
  rolls: StoredRoll[];
}

/** Relit une partie (reprise après redémarrage) ; null si elle n'existe pas. */
export async function loadGame(db: Sql, gameId: string): Promise<LoadedGame | null> {
  const g = await db.query<GameRow>(
    `SELECT id, context, variant::text AS variant, rules, ranked, stake_per_player, status, started_at, created_at, listed, rng_secret
       FROM games WHERE id = $1`,
    [gameId],
  );
  const row = g.rows[0];
  if (!row) return null;
  const p = await db.query<{ seat: number; user_id: string | null; display_name: string; team: number | null; staking: boolean; kind: string | null }>(
    `SELECT gp.seat, gp.user_id, gp.display_name, gp.team, gp.staking, u.kind::text AS kind
       FROM game_players gp LEFT JOIN users u ON u.id = gp.user_id WHERE gp.game_id = $1 ORDER BY gp.seat`,
    [gameId],
  );
  const machine = row.rules.machine;
  const seats: SeatConfig[] = p.rows.map((s) => ({
    seat: s.seat,
    userId: s.user_id,
    name: s.display_name,
    ...(s.user_id === null && machine ? { machine: { difficulty: machine.difficulty } } : {}),
    ...(s.team !== null ? { team: s.team } : {}),
    staking: s.staking,
    guest: s.kind === 'guest',
  }));
  const m = await db.query<{ ply: number; seat: number; kind: string; roll_index: number | null; payload: { n?: string }; clock_ms: number | null; played_by: string; server_ts: Date }>(
    'SELECT ply, seat, kind, roll_index, payload, clock_ms, played_by, server_ts FROM moves WHERE game_id = $1 ORDER BY ply',
    [gameId],
  );
  const d = await db.query<{ roll_index: number; seat: number; client_seed: Buffer; value: number }>(
    'SELECT roll_index, seat, client_seed, value FROM dice_rolls WHERE game_id = $1 ORDER BY roll_index',
    [gameId],
  );
  return {
    config: {
      id: row.id,
      context: row.context,
      family: familyOf(row.variant),
      variant: row.variant,
      ranked: row.ranked,
      stake: row.stake_per_player,
      seats,
      rules: row.rules,
      startedAt: row.started_at ?? row.created_at,
      listed: row.listed,
    },
    status: row.status,
    secret: row.rng_secret ? new Uint8Array(row.rng_secret) : null,
    moves: m.rows.map((x) => ({
      ply: x.ply,
      seat: x.seat,
      kind: x.kind,
      rollIndex: x.roll_index,
      notation: x.payload.n ?? null,
      clockMs: x.clock_ms,
      playedBy: x.played_by,
      at: x.server_ts,
    })),
    rolls: d.rows.map((x) => ({ rollIndex: x.roll_index, seat: x.seat, clientSeed: x.client_seed, value: x.value })),
  };
}

export async function insertRoll(db: Sql, gameId: string, roll: StoredRoll, at: Date): Promise<void> {
  await db.query('INSERT INTO dice_rolls (game_id, roll_index, seat, client_seed, value, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    gameId,
    roll.rollIndex,
    roll.seat,
    roll.clientSeed,
    roll.value,
    at.toISOString(),
  ]);
}

export async function insertMove(
  db: Sql,
  gameId: string,
  move: { ply: number; turnNo: number; seat: number; kind: string; rollIndex: number | null; notation: string; clockMs: number | null; playedBy: 'human' | 'ai' | 'auto'; state: unknown },
  at: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO moves (game_id, ply, turn_no, seat, kind, roll_index, payload, clock_ms, played_by, state_hash, server_ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      gameId,
      move.ply,
      move.turnNo,
      move.seat,
      move.kind,
      move.rollIndex,
      JSON.stringify({ n: move.notation }),
      move.clockMs,
      move.playedBy,
      stateHash(move.state),
      at.toISOString(),
    ],
  );
}

/** Fin de partie : statut, raison, places, secret du dé révélé. */
export async function writeEnd(db: Sql, gameId: string, outcome: Outcome, status: 'finished' | 'aborted', at: Date): Promise<void> {
  await db.query(
    `UPDATE games SET status = $2, end_reason = $3, ended_at = $4, rng_server_seed = rng_secret WHERE id = $1`,
    [gameId, status, outcome.reason, at.toISOString()],
  );
  const best = Math.min(...Object.values(outcome.places));
  for (const [seat, place] of Object.entries(outcome.places)) {
    const result = outcome.draw ? 'draw' : place === best ? 'win' : 'loss';
    await db.query('UPDATE game_players SET place = $3, result = $4 WHERE game_id = $1 AND seat = $2', [gameId, Number(seat), outcome.draw ? null : place, result]);
  }
}

export async function markSeatOut(db: Sql, gameId: string, seat: number, at: Date): Promise<void> {
  await db.query('UPDATE game_players SET out_at = $3 WHERE game_id = $1 AND seat = $2', [gameId, seat, at.toISOString()]);
}

/** Parties à reprendre au démarrage. */
export async function playingGameIds(db: Sql): Promise<string[]> {
  const r = await db.query<{ id: string }>(`SELECT id FROM games WHERE status = 'playing' AND rules_version = $1`, [RULES_VERSION]);
  return r.rows.map((x) => x.id);
}
