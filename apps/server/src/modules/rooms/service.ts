/**
 * Salons (écrans 24 et 25, SPEC §10) : création, aperçu par code, places, file d'attente,
 * spectateurs, prêts, lancement par l'hôte, formats (partie simple, aller-retour, roi de la
 * table), hôte parti, place gardée 60 s, fermeture après 30 min sans partie, invitations.
 *
 * Le serveur fait foi : chaque changement est écrit en base, puis la vue du salon est
 * renvoyée à chaque abonné (`room.state`, calculée pour lui).
 */
import { randomInt } from 'node:crypto';
import {
  DEFAULT_ROOM_CLOCK,
  DEFAULT_ROOM_TURN_MS,
  ROOM_CLOCKS,
  ROOM_TURN_MS,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type RoomPreview,
  type RoomView,
} from '@kwatt/protocol';
import { PRESETS, validateSetup } from '@kwatt/rules-ludo';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { RealtimeHub } from '../../realtime/hub.js';
import { sharedDevicePairs } from '../auth/devices.js';
import { areFriends, isBlocked } from '../friends/relations.js';
import { facingTeams, ludoOptions, LUDO_PRESET_OF } from '../games/engine.js';
import type { GameFinishedEvent, GamesService } from '../games/service.js';
import { assertStake, stakeProfile } from '../games/stakes.js';
import type { MediaStore } from '../media/store.js';
import type { NotificationService } from '../notifications/service.js';
import { loadLooks } from '../profiles/look.js';

/** Alphabet des codes : sans 0, O, 1, I. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SEAT_KEPT_MS = 60_000;
export const ROOM_IDLE_MS = 30 * 60_000;

export const roomTopic = (code: string): string => `room:${code}`;

export interface RoomActor {
  userId: string;
  kind: 'guest' | 'member';
  pseudo: string | null;
}

export interface PrivateTableInput {
  variant: string;
  format: 'simple' | 'aller_retour';
  clock: { initialMs: number; incrementMs: number } | null;
  turnMs: number | null;
  stake: number;
  ranked: boolean;
  name: string;
  players: [{ userId: string }, { userId: string }];
}

export interface RoomDeps {
  db: Pool;
  clock: Clock;
  log: Logger;
  hub: RealtimeHub;
  games: GamesService;
  media: MediaStore;
  notifications: NotificationService;
}

interface RoomRow {
  id: string;
  code: string;
  variant: string;
  rules: { house: Record<string, string> | null; teams: boolean };
  seats: number;
  format: 'simple' | 'aller_retour' | 'roi';
  clock_base_ms: number | null;
  clock_inc_ms: number | null;
  turn_ms: number | null;
  stake: number;
  ranked: boolean;
  host_user_id: string;
  status: 'open' | 'playing' | 'closed';
  name: string;
  game_id: string | null;
  last_game_id: string | null;
  leg: 1 | 2 | null;
  king_user_id: string | null;
  king_wins: number;
  last_activity_at: Date;
  created_at: Date;
  listed: boolean;
}

interface MemberRow {
  user_id: string;
  role: 'seat' | 'queue' | 'spectator';
  seat_index: number | null;
  queue_pos: number | null;
  staking: boolean;
  ready: boolean;
  kept_until: Date | null;
  joined_at: Date;
  pseudo: string;
  guest: boolean;
}

export const gameOfVariant = (variant: string): 'dames' | 'ludo' => (variant.startsWith('ludo') ? 'ludo' : 'dames');

/** Places possibles à table pour une variante (planche CreerSalon). */
export function seatRange(variant: string): [number, number] | null {
  if (variant === 'dames10' || variant === 'dames8') return [2, 2];
  const preset = LUDO_PRESET_OF[variant];
  if (!preset) return null;
  return PRESETS[preset].players;
}

function invalid(reason: string, params: Record<string, string | number> = {}): AppError {
  return new AppError('room.invalid_settings', 400, { reason, ...params });
}

export function newRoomCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

async function roomByCode(db: Sql, code: string, lock = false): Promise<RoomRow> {
  const r = await db.query<RoomRow>(
    `SELECT id, code, variant::text AS variant, rules, seats, format, clock_base_ms, clock_inc_ms, turn_ms, stake, ranked, host_user_id,
            status, name, game_id, last_game_id, leg, king_user_id, king_wins, last_activity_at, created_at, listed
       FROM rooms WHERE code = $1 ORDER BY (status <> 'closed') DESC, created_at DESC LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
    [code],
  );
  const row = r.rows[0];
  if (!row) throw new AppError('room.not_found', 404);
  return row;
}

async function openRoom(db: Sql, code: string): Promise<RoomRow> {
  const room = await roomByCode(db, code, true);
  if (room.status === 'closed') throw new AppError('room.closed', 410);
  return room;
}

async function membersOf(db: Sql, roomId: string): Promise<MemberRow[]> {
  const r = await db.query<MemberRow>(
    `SELECT m.user_id, m.role, m.seat_index, m.queue_pos, m.staking, m.ready, m.kept_until, m.joined_at,
            COALESCE(p.pseudo::text, u.display_name, '?') AS pseudo, (u.kind = 'guest') AS guest
       FROM room_members m JOIN users u ON u.id = m.user_id LEFT JOIN profiles p ON p.user_id = m.user_id
      WHERE m.room_id = $1 AND m.left_at IS NULL
      ORDER BY m.joined_at, m.user_id`,
    [roomId],
  );
  return r.rows;
}

/** Vue complète du salon pour `viewerId` (écran 25). */
export async function roomView(deps: Pick<RoomDeps, 'db' | 'hub' | 'media' | 'clock'>, code: string, viewerId: string | null): Promise<RoomView> {
  const room = await roomByCode(deps.db, code);
  const members = await membersOf(deps.db, room.id);
  const looks = await loadLooks(deps.db, deps.media, members.map((m) => m.user_id), viewerId);
  const player = (m: MemberRow) => ({
    userId: m.user_id,
    pseudo: m.pseudo,
    avatar: looks.get(m.user_id) ?? null,
    guest: m.guest,
    staking: m.staking,
    connected: deps.hub.isOnline(m.user_id),
  });
  const host = members.find((m) => m.user_id === room.host_user_id);
  const hostName = host?.pseudo ?? (await deps.db.query<{ pseudo: string }>(`SELECT COALESCE(p.pseudo::text, u.display_name, '?') AS pseudo FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`, [room.host_user_id])).rows[0]?.pseudo ?? '?';
  const me = viewerId ? members.find((m) => m.user_id === viewerId) : undefined;
  const king = room.king_user_id ? members.find((m) => m.user_id === room.king_user_id) : undefined;
  const canStake = viewerId && room.stake > 0 ? (await stakeProfile(deps.db, viewerId, room.variant, deps.clock.now())).refusal === null : false;
  const queue = members.filter((m) => m.role === 'queue').sort((a, b) => (a.queue_pos ?? 0) - (b.queue_pos ?? 0));
  return {
    code: room.code,
    game: gameOfVariant(room.variant),
    variant: room.variant,
    name: room.name,
    host: { userId: room.host_user_id, pseudo: hostName },
    seats: room.seats,
    format: room.format,
    stake: room.stake,
    status: room.status,
    friendly: !room.ranked,
    house: room.rules.house,
    teams: room.rules.teams,
    clock: room.clock_base_ms !== null ? { initialMs: room.clock_base_ms, incrementMs: room.clock_inc_ms ?? 0 } : null,
    turnMs: room.turn_ms,
    table: Array.from({ length: room.seats }, (_, seat) => {
      const m = members.find((x) => x.role === 'seat' && x.seat_index === seat);
      return {
        seat,
        player: m ? player(m) : null,
        ready: m ? m.ready || m.user_id === room.host_user_id : false,
        keptUntil: m?.kept_until?.toISOString() ?? null,
      };
    }),
    queue: queue.map((m, i) => ({ ...player(m), position: i + 1 })),
    spectators: members.filter((m) => m.role === 'spectator').length,
    me: {
      role: me?.role ?? null,
      seat: me?.role === 'seat' ? me.seat_index : null,
      ready: me ? me.ready || me.user_id === room.host_user_id : false,
      isHost: viewerId === room.host_user_id,
      canStake,
    },
    gameId: room.game_id,
    lastGameId: room.last_game_id,
    leg: room.format === 'aller_retour' ? (room.leg ?? 1) : null,
    king: king ? { userId: king.user_id, pseudo: king.pseudo, wins: room.king_wins } : null,
    closesAt: room.status === 'open' ? new Date(room.last_activity_at.getTime() + ROOM_IDLE_MS).toISOString() : null,
    createdAt: room.created_at.toISOString(),
  };
}

/** Aperçu par code (écran 02, sans profil). */
export async function roomPreview(db: Sql, code: string): Promise<RoomPreview> {
  const room = await roomByCode(db, code);
  if (room.status === 'closed') throw new AppError('room.closed', 410);
  const members = await membersOf(db, room.id);
  const host = await db.query<{ pseudo: string }>(`SELECT COALESCE(p.pseudo::text, u.display_name, '?') AS pseudo FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`, [room.host_user_id]);
  return {
    code: room.code,
    game: gameOfVariant(room.variant),
    variant: room.variant,
    name: room.name,
    host: { userId: room.host_user_id, pseudo: host.rows[0]?.pseudo ?? '?' },
    seats: room.seats,
    seated: members.filter((m) => m.role === 'seat').map((m) => ({ userId: m.user_id, pseudo: m.pseudo, avatar: null })),
    queueLength: members.filter((m) => m.role === 'queue').length,
    format: room.format,
    stake: room.stake,
    status: room.status,
  };
}

/** Salons ouverts et listés (accueil 07 : « salons ouverts »). */
export async function openRooms(db: Sql, game: 'dames' | 'ludo' | undefined): Promise<RoomPreview[]> {
  const r = await db.query<{ code: string }>(
    `SELECT code FROM rooms WHERE status <> 'closed' AND listed
        AND ($1::text IS NULL OR (CASE WHEN variant::text LIKE 'ludo%' THEN 'ludo' ELSE 'dames' END) = $1::text)
      ORDER BY last_activity_at DESC LIMIT 20`,
    [game ?? null],
  );
  return Promise.all(r.rows.map((x) => roomPreview(db, x.code)));
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

export class RoomsService {
  constructor(private readonly deps: RoomDeps) {}

  private now(): Date {
    return this.deps.clock.now();
  }

  /** Renvoie la vue du salon à chaque abonné (après validation). */
  async publish(code: string): Promise<void> {
    const conns = this.deps.hub.subscribers(roomTopic(code));
    const views = new Map<string, RoomView>();
    for (const conn of conns) {
      let view = views.get(conn.userId);
      if (!view) {
        view = await roomView(this.deps, code, conn.userId);
        views.set(conn.userId, view);
      }
      this.deps.hub.send(conn, { t: 'room.state', room: view });
    }
  }

  private async run<T>(code: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const result = await transaction(this.deps.db, fn);
    await this.publish(code).catch((err: unknown) => this.deps.log.warn({ err }, 'diffusion du salon en échec'));
    return result;
  }

  /** POST /v1/rooms : l'hôte s'assoit à la place 0. */
  async create(actor: RoomActor, req: CreateRoomRequest): Promise<string> {
    if (actor.kind !== 'member') throw new AppError('auth.member_required', 403);
    const range = seatRange(req.variant);
    if (!range || gameOfVariant(req.variant) !== req.game) throw invalid('variant');
    if (req.seats < range[0] || req.seats > range[1]) throw invalid('seats', { min: range[0], max: range[1] });
    const game = req.game;
    const house = game === 'ludo' && req.house && Object.keys(req.house).length > 0 ? req.house : null;
    const teams = game === 'ludo' && (req.teams === true || req.variant === 'ludo_pachisi');
    if (game === 'ludo') {
      const check = validateSetup(ludoOptions({ variant: req.variant, players: req.seats, teams: teams ? facingTeams(req.seats) : null, house }));
      if (!check.ok) throw invalid(check.code);
    }
    const preset = LUDO_PRESET_OF[req.variant];
    const friendly = house !== null || (preset !== undefined && !PRESETS[preset].ranked);
    if (friendly && req.stake > 0) throw invalid('friendly_stake');
    let clock: { initialMs: number; incrementMs: number } | null = null;
    if (game === 'dames') {
      clock = req.clock ?? DEFAULT_ROOM_CLOCK;
      if (!ROOM_CLOCKS.some((c) => c.initialMs === clock!.initialMs && c.incrementMs === clock!.incrementMs)) throw invalid('clock');
    }
    const turnMs = game === 'ludo' ? (req.turnMs ?? DEFAULT_ROOM_TURN_MS) : null;
    if (turnMs !== null && !(ROOM_TURN_MS as readonly number[]).includes(turnMs)) throw invalid('turn');
    const now = this.now();
    let staking = false;
    if (req.stake > 0) {
      const p = await stakeProfile(this.deps.db, actor.userId, req.variant, now);
      if (p.refusal) throw new AppError(p.refusal, 403);
      staking = true;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = newRoomCode();
      try {
        await transaction(this.deps.db, async (tx) => {
          const r = await tx.query<{ id: string }>(
            `INSERT INTO rooms (code, variant, rules, seats, format, clock_base_ms, clock_inc_ms, turn_ms, stake, ranked, host_user_id, status, name, last_activity_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', $12, $13, $13) RETURNING id`,
            [code, req.variant, JSON.stringify({ house, teams }), req.seats, req.format, clock?.initialMs ?? null, clock?.incrementMs ?? null, turnMs, req.stake, !friendly, actor.userId, req.name.trim(), now],
          );
          await tx.query(
            `INSERT INTO room_members (room_id, user_id, role, seat_index, staking, ready, joined_at) VALUES ($1, $2, 'seat', 0, $3, true, $4)`,
            [r.rows[0]!.id, actor.userId, staking, now],
          );
        });
        return code;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') continue;
        throw err;
      }
    }
    throw new AppError('common.internal', 500);
  }

  /** S'asseoir (place libre ou demandée), entrer dans la file, ou regarder. */
  async join(actor: RoomActor, code: string, req: JoinRoomRequest): Promise<void> {
    await this.run(code, async (tx) => {
      const room = await openRoom(tx, code);
      const now = this.now();
      const members = await membersOf(tx, room.id);
      const me = members.find((m) => m.user_id === actor.userId);
      let role = req.as;
      let seat: number | null = null;
      if (role === 'seat') {
        if (me?.role === 'seat') return;
        if (room.status === 'playing') role = 'queue';
        else {
          const taken = new Set(members.filter((m) => m.role === 'seat').map((m) => m.seat_index));
          if (req.seat !== undefined) {
            if (req.seat >= room.seats) throw new AppError('room.invalid_settings', 400, { reason: 'seat' });
            if (taken.has(req.seat)) throw new AppError('room.seat_taken', 409);
            seat = req.seat;
          } else {
            // Table pleine : on entre dans la file plutôt que d'essuyer un refus.
            seat = Array.from({ length: room.seats }, (_, i) => i).find((i) => !taken.has(i)) ?? null;
            if (seat === null) role = 'queue';
          }
        }
      }
      // Mise : profils de 18 ans et plus, jamais deux comptes du même appareil à la même table.
      let staking = false;
      if (room.stake > 0 && actor.kind === 'member' && role !== 'spectator') {
        const p = await stakeProfile(tx, actor.userId, room.variant, now);
        if (p.refusal === null) {
          const others = members.filter((m) => m.staking && m.user_id !== actor.userId).map((m) => m.user_id);
          if ((await sharedDevicePairs(tx, [actor.userId, ...others])).some(([a, b]) => a === actor.userId || b === actor.userId)) {
            throw new AppError('stake.same_device', 403);
          }
          staking = true;
        }
      }
      const queuePos = role === 'queue' ? Math.max(0, ...members.filter((m) => m.role === 'queue').map((m) => m.queue_pos ?? 0)) + 1 : null;
      await tx.query(
        `INSERT INTO room_members (room_id, user_id, role, seat_index, queue_pos, staking, ready, joined_at, left_at, kept_until)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7, NULL, NULL)
         ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role, seat_index = EXCLUDED.seat_index, queue_pos = EXCLUDED.queue_pos,
           staking = EXCLUDED.staking, ready = false, left_at = NULL, kept_until = NULL,
           joined_at = CASE WHEN room_members.left_at IS NULL THEN room_members.joined_at ELSE EXCLUDED.joined_at END`,
        [room.id, actor.userId, role, seat, queuePos, staking, now],
      );
      await tx.query('UPDATE rooms SET last_activity_at = $2 WHERE id = $1', [room.id, now]);
    });
  }

  /** Quitter le salon (la place se libère tout de suite ; l'hôte passe au plus ancien). */
  async leave(actor: RoomActor, code: string): Promise<void> {
    await this.run(code, async (tx) => {
      const room = await roomByCode(tx, code, true);
      if (room.status === 'closed') return;
      await this.removeMember(tx, room, actor.userId);
    });
  }

  private async removeMember(tx: Transaction, room: RoomRow, userId: string): Promise<void> {
    const now = this.now();
    await tx.query('UPDATE room_members SET left_at = $3, ready = false, kept_until = NULL WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL', [room.id, userId, now]);
    const rest = await membersOf(tx, room.id);
    if (rest.length === 0) {
      if (room.status !== 'playing') await tx.query(`UPDATE rooms SET status = 'closed', closed_at = $2 WHERE id = $1`, [room.id, now]);
      return;
    }
    if (room.host_user_id === userId) {
      // Le plus ancien encore présent (assis, puis file, puis spectateur) devient hôte.
      const order = { seat: 0, queue: 1, spectator: 2 } as const;
      const next = [...rest].sort((a, b) => order[a.role] - order[b.role] || a.joined_at.getTime() - b.joined_at.getTime())[0]!;
      await tx.query('UPDATE rooms SET host_user_id = $2 WHERE id = $1', [room.id, next.user_id]);
    }
    if (room.status === 'open') await this.fillSeats(tx, room);
  }

  /** Les places libres vont aux premiers de la file. */
  private async fillSeats(tx: Transaction, room: RoomRow): Promise<void> {
    const members = await membersOf(tx, room.id);
    const taken = new Set(members.filter((m) => m.role === 'seat').map((m) => m.seat_index));
    const queue = members.filter((m) => m.role === 'queue').sort((a, b) => (a.queue_pos ?? 0) - (b.queue_pos ?? 0));
    for (let seat = 0; seat < room.seats && queue.length > 0; seat++) {
      if (taken.has(seat)) continue;
      const next = queue.shift()!;
      await tx.query(`UPDATE room_members SET role = 'seat', seat_index = $3, queue_pos = NULL, ready = false WHERE room_id = $1 AND user_id = $2`, [room.id, next.user_id, seat]);
    }
  }

  async setReady(actor: RoomActor, code: string, ready: boolean): Promise<void> {
    await this.run(code, async (tx) => {
      const room = await openRoom(tx, code);
      const r = await tx.query(`UPDATE room_members SET ready = $3 WHERE room_id = $1 AND user_id = $2 AND role = 'seat' AND left_at IS NULL`, [room.id, actor.userId, ready]);
      if (r.rowCount === 0) throw new AppError('room.not_member', 403);
    });
  }

  /** L'hôte lance la partie : sièges dans l'ordre (aller-retour : couleurs échangées / places tournées). */
  async start(actor: RoomActor, code: string): Promise<string> {
    return this.run(code, async (tx) => {
      const room = await openRoom(tx, code);
      if (room.host_user_id !== actor.userId) throw new AppError('room.not_host', 403);
      return this.startGame(tx, room);
    });
  }

  /** Démarre une partie dans le salon (hôte, ou défi accepté). */
  async startGame(tx: Transaction, room: RoomRow): Promise<string> {
    if (room.status === 'playing' || room.game_id) throw new AppError('room.playing', 409);
    const now = this.now();
    const members = await membersOf(tx, room.id);
    let seated = members.filter((m) => m.role === 'seat').sort((a, b) => (a.seat_index ?? 0) - (b.seat_index ?? 0));
    const min = gameOfVariant(room.variant) === 'dames' || room.variant === 'ludo_pachisi' ? room.seats : 2;
    if (seated.length < min) throw new AppError('room.not_enough_players', 409, { min });
    if (seated.some((m) => !m.ready && m.user_id !== room.host_user_id)) throw new AppError('room.not_ready', 409);
    const leg = room.format === 'aller_retour' ? (room.leg ?? 1) : null;
    if (leg === 2 && seated.length > 1) seated = [...seated.slice(1), seated[0]!];
    const stakers = seated.filter((m) => m.staking);
    const staked = room.stake > 0 && stakers.length >= 2;
    if (staked) await assertStake(tx, stakers.map((m) => m.user_id), room.variant, room.stake, now, room.host_user_id);
    const players = seated.length;
    const teams = room.rules.teams && players % 2 === 0 ? facingTeams(players) : null;
    const cfg = await this.deps.games.createGame(tx, {
      context: 'room',
      variant: room.variant,
      seats: seated.map((m) => ({ userId: m.user_id, name: m.pseudo, staking: staked && m.staking, guest: m.guest, ...(teams ? { team: teams.findIndex((t) => t.includes(seated.indexOf(m))) } : {}) })),
      ranked: room.ranked,
      stake: staked ? room.stake : 0,
      clock: room.clock_base_ms !== null ? { initialMs: room.clock_base_ms, incrementMs: room.clock_inc_ms ?? 0 } : null,
      turnMs: room.turn_ms,
      teams,
      house: room.rules.house,
      room: { roomId: room.id, code: room.code, leg },
      listed: room.listed,
    });
    await tx.query(`UPDATE rooms SET status = 'playing', game_id = $2, last_activity_at = $3, leg = $4 WHERE id = $1`, [room.id, cfg.id, now, leg]);
    return cfg.id;
  }

  /**
   * Table privée de deux joueurs (défi accepté) : salon non listé, les deux assis et
   * prêts, partie lancée dans la même transaction. Le premier joueur est l'hôte.
   */
  async startPrivateTable(tx: Transaction, input: PrivateTableInput): Promise<{ code: string; gameId: string }> {
    const now = this.now();
    let code = newRoomCode();
    for (let attempt = 0; attempt < 8; attempt++) {
      const taken = await tx.query("SELECT 1 FROM rooms WHERE code = $1 AND status <> 'closed'", [code]);
      if ((taken.rowCount ?? 0) === 0) break;
      code = newRoomCode();
    }
    const host = input.players[0]!;
    const r = await tx.query<{ id: string }>(
      `INSERT INTO rooms (code, variant, rules, seats, format, clock_base_ms, clock_inc_ms, turn_ms, stake, ranked, host_user_id, status, name, last_activity_at, created_at, listed)
       VALUES ($1, $2, $3, 2, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $12, $12, false) RETURNING id`,
      [code, input.variant, JSON.stringify({ house: null, teams: false }), input.format, input.clock?.initialMs ?? null, input.clock?.incrementMs ?? null, input.turnMs, input.stake, input.ranked, host.userId, input.name, now],
    );
    const roomId = r.rows[0]!.id;
    for (const [seat, p] of input.players.entries()) {
      await tx.query(
        `INSERT INTO room_members (room_id, user_id, role, seat_index, staking, ready, joined_at) VALUES ($1, $2, 'seat', $3, $4, true, $5)`,
        [roomId, p.userId, seat, input.stake > 0, now],
      );
    }
    const room = await roomByCode(tx, code, true);
    const gameId = await this.startGame(tx, room);
    return { code, gameId };
  }

  /** Fin d'une partie du salon : formats, roi de la table, file d'attente. */
  async onGameFinished(event: GameFinishedEvent): Promise<void> {
    if (!event.room) return;
    const code = event.room.code;
    await this.run(code, async (tx) => {
      const room = await roomByCode(tx, code, true);
      if (room.game_id !== event.gameId) return;
      const now = this.now();
      const members = await membersOf(tx, room.id);
      const placeOf = (userId: string) => {
        const s = event.seats.find((x) => x.userId === userId);
        return s ? (event.outcome.places[String(s.seat)] ?? event.seats.length) : event.seats.length;
      };
      let king = room.king_user_id;
      let kingWins = room.king_wins;
      if (room.format === 'roi') {
        const seated = members.filter((m) => m.role === 'seat');
        const worst = Math.max(...seated.map((m) => placeOf(m.user_id)));
        // Dames : le perdant cède sa place (nulle : le challengeur, pas le roi) ; Ludo : le dernier sort.
        let out = seated.filter((m) => placeOf(m.user_id) === worst);
        if (event.outcome.draw) out = seated.filter((m) => m.user_id !== room.king_user_id).slice(0, 1);
        const winner = event.outcome.draw ? null : seated.find((m) => placeOf(m.user_id) === 1);
        if (winner) {
          kingWins = winner.user_id === king ? kingWins + 1 : 1;
          king = winner.user_id;
        }
        const queueMax = Math.max(0, ...members.filter((m) => m.role === 'queue').map((m) => m.queue_pos ?? 0));
        const hasQueue = members.some((m) => m.role === 'queue');
        if (hasQueue) {
          for (const [i, m] of out.entries()) {
            await tx.query(`UPDATE room_members SET role = 'queue', seat_index = NULL, queue_pos = $3 WHERE room_id = $1 AND user_id = $2`, [room.id, m.user_id, queueMax + 1 + i]);
          }
        }
      }
      const leg = room.format === 'aller_retour' ? ((room.leg ?? 1) === 1 ? 2 : 1) : null;
      await tx.query(
        `UPDATE rooms SET status = 'open', game_id = NULL, last_game_id = $2, last_activity_at = $3, leg = $4, king_user_id = $5, king_wins = $6 WHERE id = $1`,
        [room.id, event.gameId, now, leg, king, kingWins],
      );
      await tx.query('UPDATE room_members SET ready = false WHERE room_id = $1', [room.id]);
      await this.fillSeats(tx, { ...room, status: 'open' });
    });
  }

  /** Inviter un ami dans le salon : notification `invites.room`. */
  async invite(actor: RoomActor, code: string, toUserId: string): Promise<void> {
    const room = await roomByCode(this.deps.db, code);
    if (room.status === 'closed') throw new AppError('room.closed', 410);
    const members = await membersOf(this.deps.db, room.id);
    if (!members.some((m) => m.user_id === actor.userId)) throw new AppError('room.not_member', 403);
    if (toUserId === actor.userId || (await isBlocked(this.deps.db, actor.userId, toUserId)) || !(await areFriends(this.deps.db, actor.userId, toUserId))) {
      throw new AppError('room.invite_refused', 403);
    }
    await this.deps.notifications.notify(
      this.deps.db,
      toUserId,
      'invites.room',
      { from: actor.pseudo ?? '?', fromUserId: actor.userId, code: room.code, game: gameOfVariant(room.variant), variant: room.variant, roomName: room.name },
      { push: 'always' },
    );
  }

  /** Présence : une place est gardée 60 s après une coupure. */
  async presence(userId: string, online: boolean): Promise<void> {
    const now = this.now();
    const r = await this.deps.db.query<{ code: string }>(
      `UPDATE room_members m SET kept_until = $2
         FROM rooms r WHERE r.id = m.room_id AND r.status = 'open' AND m.user_id = $1 AND m.role = 'seat' AND m.left_at IS NULL
         RETURNING r.code`,
      [userId, online ? null : new Date(now.getTime() + SEAT_KEPT_MS)],
    );
    for (const row of r.rows) await this.publish(row.code);
  }

  /** Places gardées expirées, salons inactifs depuis 30 min. */
  async tick(): Promise<void> {
    const now = this.now();
    const expired = await this.deps.db.query<{ code: string; user_id: string }>(
      `SELECT r.code, m.user_id FROM room_members m JOIN rooms r ON r.id = m.room_id
        WHERE r.status = 'open' AND m.left_at IS NULL AND m.kept_until IS NOT NULL AND m.kept_until <= $1`,
      [now],
    );
    for (const row of expired.rows) {
      if (this.deps.hub.isOnline(row.user_id)) continue;
      await this.run(row.code, async (tx) => {
        const room = await roomByCode(tx, row.code, true);
        await this.removeMember(tx, room, row.user_id);
      });
    }
    const idle = await this.deps.db.query<{ code: string }>(
      `UPDATE rooms SET status = 'closed', closed_at = $1 WHERE status = 'open' AND game_id IS NULL AND last_activity_at <= $2 RETURNING code`,
      [now, new Date(now.getTime() - ROOM_IDLE_MS)],
    );
    for (const row of idle.rows) await this.publish(row.code);
  }
}

export type { RoomRow };
export { roomByCode, openRoom };
