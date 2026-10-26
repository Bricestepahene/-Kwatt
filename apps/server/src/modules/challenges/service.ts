/**
 * Défis entre deux joueurs, avec ou sans mise (écran 26, /defi/nouveau, /defi/[id]).
 *
 * Cycle : l'auteur propose (le défié doit répondre) ; le défié accepte, refuse ou fait une
 * contre-proposition de mise (c'est alors à l'auteur de répondre) ; l'auteur peut retirer son
 * défi. Un défi expire 2 h après la dernière proposition. Accepté : salon privé de deux
 * joueurs, mises bloquées et partie lancée dans la même transaction.
 *
 * On défie un ami, ou l'adversaire d'une partie pour la revanche ; jamais un joueur bloqué.
 */
import {
  CHALLENGE_TTL_MS,
  DEFAULT_ROOM_CLOCK,
  DEFAULT_ROOM_TURN_MS,
  ROOM_CLOCKS,
  type ChallengeView,
  type CreateChallengeRequest,
} from '@kwatt/protocol';
import { PRESETS } from '@kwatt/rules-ludo';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { MediaStore } from '../media/store.js';
import type { NotificationService } from '../notifications/service.js';
import { loadLooks } from '../profiles/look.js';
import { areFriends, isBlocked } from '../friends/relations.js';
import { LUDO_PRESET_OF } from '../games/engine.js';
import { assertStake, capBetween } from '../games/stakes.js';
import { gameOfVariant, seatRange, type RoomsService } from '../rooms/service.js';

export interface ChallengeDeps {
  db: Pool;
  clock: Clock;
  media: MediaStore;
  notifications: NotificationService;
  rooms: RoomsService;
}

export interface ChallengeActor {
  userId: string;
  kind: 'guest' | 'member';
  pseudo: string | null;
}

interface ChallengeRow {
  id: string;
  from_user_id: string;
  to_user_id: string;
  variant: string;
  format: 'simple' | 'aller_retour';
  clock_base_ms: number | null;
  clock_inc_ms: number | null;
  stake: number;
  awaiting: string | null;
  countered: boolean;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  rematch_of: string | null;
  room_id: string | null;
  game_id: string | null;
  expires_at: Date;
  created_at: Date;
  room_code: string | null;
}

const SELECT = `SELECT c.id, c.from_user_id, c.to_user_id, c.variant::text AS variant, c.format, c.clock_base_ms, c.clock_inc_ms, c.stake,
                       c.awaiting, c.countered, c.status, c.rematch_of, c.room_id, c.game_id, c.expires_at, c.created_at, r.code::text AS room_code
                  FROM challenges c LEFT JOIN rooms r ON r.id = c.room_id`;

/** Variante amicale (Parchís, Pachisi…) : pas de mise ni de classement. */
function isFriendly(variant: string): boolean {
  const preset = LUDO_PRESET_OF[variant];
  return preset !== undefined && !PRESETS[preset].ranked;
}

async function pseudos(db: Sql, ids: string[]): Promise<Map<string, string>> {
  const r = await db.query<{ id: string; pseudo: string }>(
    `SELECT u.id, COALESCE(p.pseudo::text, u.display_name, '?') AS pseudo FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(r.rows.map((x) => [x.id, x.pseudo]));
}

export class ChallengesService {
  constructor(private readonly deps: ChallengeDeps) {}

  private now(): Date {
    return this.deps.clock.now();
  }

  private async row(db: Sql, id: string, lock = false): Promise<ChallengeRow> {
    const r = await db.query<ChallengeRow>(`${SELECT} WHERE c.id = $1 ${lock ? 'FOR UPDATE OF c' : ''}`, [id]);
    const row = r.rows[0];
    if (!row) throw new AppError('challenge.not_found', 404);
    return row;
  }

  /** Vue d'un défi pour l'un de ses deux joueurs. */
  async view(id: string, viewerId: string): Promise<ChallengeView> {
    const row = await this.row(this.deps.db, id);
    if (viewerId !== row.from_user_id && viewerId !== row.to_user_id) throw new AppError('challenge.not_found', 404);
    return this.toView(row, viewerId);
  }

  private async toView(row: ChallengeRow, viewerId: string): Promise<ChallengeView> {
    const ids = [row.from_user_id, row.to_user_id];
    const [names, looks, { view: cap }] = await Promise.all([
      pseudos(this.deps.db, ids),
      loadLooks(this.deps.db, this.deps.media, ids, viewerId),
      capBetween(this.deps.db, ids, row.variant, this.now(), viewerId),
    ]);
    const player = (userId: string) => ({ userId, pseudo: names.get(userId) ?? '?', avatar: looks.get(userId) ?? null });
    return {
      id: row.id,
      from: player(row.from_user_id),
      to: player(row.to_user_id),
      game: gameOfVariant(row.variant),
      variant: row.variant,
      format: row.format,
      clock: row.clock_base_ms !== null ? { initialMs: row.clock_base_ms, incrementMs: row.clock_inc_ms ?? 0 } : null,
      stake: row.stake,
      status: row.status,
      awaiting: row.status === 'pending' ? row.awaiting : null,
      countered: row.countered,
      rematchOf: row.rematch_of,
      cap,
      expiresAt: row.expires_at.toISOString(),
      gameId: row.game_id,
      roomCode: row.room_code,
      createdAt: row.created_at.toISOString(),
    };
  }

  /** Défis en attente (reçus et envoyés), puis les acceptés des dernières 24 h. */
  async list(viewerId: string): Promise<ChallengeView[]> {
    const r = await this.deps.db.query<ChallengeRow>(
      `${SELECT} WHERE (c.from_user_id = $1 OR c.to_user_id = $1)
          AND (c.status = 'pending' OR (c.status = 'accepted' AND c.created_at > $2::timestamptz - interval '24 hours'))
        ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 30`,
      [viewerId, this.now()],
    );
    return Promise.all(r.rows.map((row) => this.toView(row, viewerId)));
  }

  /** Plafond de mise avant de défier (écran /defi/nouveau). */
  async cap(viewerId: string, otherId: string, variant: string) {
    return (await capBetween(this.deps.db, [viewerId, otherId], variant, this.now(), viewerId)).view;
  }

  async create(actor: ChallengeActor, req: CreateChallengeRequest): Promise<string> {
    if (actor.kind !== 'member') throw new AppError('auth.member_required', 403);
    const db = this.deps.db;
    const now = this.now();
    const to = req.toUserId;
    if (to === actor.userId) throw new AppError('challenge.self', 400);
    const target = await db.query<{ kind: string }>('SELECT kind::text AS kind FROM users WHERE id = $1', [to]);
    if (target.rows[0]?.kind !== 'member') throw new AppError('challenge.not_friend', 403);
    if (await isBlocked(db, actor.userId, to)) throw new AppError('challenge.blocked', 403);
    if (!(await areFriends(db, actor.userId, to)) && !(req.rematchOf && (await this.playedTogether(req.rematchOf, actor.userId, to)))) {
      throw new AppError('challenge.not_friend', 403);
    }
    const range = seatRange(req.variant);
    if (!range || range[0] > 2 || gameOfVariant(req.variant) !== req.game) throw new AppError('room.invalid_settings', 400, { reason: 'variant' });
    if (req.stake > 0 && isFriendly(req.variant)) throw new AppError('room.invalid_settings', 400, { reason: 'friendly_stake' });
    let clock: { initialMs: number; incrementMs: number } | null = null;
    if (req.game === 'dames') {
      clock = req.clock ?? DEFAULT_ROOM_CLOCK;
      if (!ROOM_CLOCKS.some((c) => c.initialMs === clock!.initialMs && c.incrementMs === clock!.incrementMs)) {
        throw new AppError('room.invalid_settings', 400, { reason: 'clock' });
      }
    }
    await assertStake(db, [actor.userId, to], req.variant, req.stake, now, actor.userId);
    return transaction(db, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO challenges (from_user_id, to_user_id, variant, format, clock_base_ms, clock_inc_ms, stake, awaiting, rematch_of, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $2, $8, $9, $10) RETURNING id`,
        [actor.userId, to, req.variant, req.format, clock?.initialMs ?? null, clock?.incrementMs ?? null, req.stake, req.rematchOf ?? null, new Date(now.getTime() + CHALLENGE_TTL_MS), now],
      );
      const id = r.rows[0]!.id;
      await this.deps.notifications.notify(
        tx,
        to,
        'invites.challenge',
        { from: actor.pseudo ?? '?', fromUserId: actor.userId, challengeId: id, game: req.game, variant: req.variant, stake: req.stake },
        { push: 'always' },
      );
      return id;
    });
  }

  private async playedTogether(gameId: string, a: string, b: string): Promise<boolean> {
    const r = await this.deps.db.query<{ n: number }>(
      'SELECT count(DISTINCT user_id)::int AS n FROM game_players WHERE game_id = $1 AND user_id = ANY($2::uuid[])',
      [gameId, [a, b]],
    );
    return r.rows[0]?.n === 2;
  }

  /** Ouvre la transaction sur un défi encore en attente (expiré : on le ferme). */
  private async pending<T>(id: string, actorId: string, fn: (tx: Transaction, row: ChallengeRow) => Promise<T>): Promise<T> {
    let expired = false;
    const result = await transaction(this.deps.db, async (tx) => {
      const row = await this.row(tx, id, true);
      if (actorId !== row.from_user_id && actorId !== row.to_user_id) throw new AppError('challenge.not_found', 404);
      if (row.status === 'pending' && row.expires_at.getTime() <= this.now().getTime()) {
        await tx.query(`UPDATE challenges SET status = 'expired' WHERE id = $1`, [id]);
        expired = true;
        return null;
      }
      if (row.status !== 'pending') throw new AppError('challenge.closed', 409);
      return { value: await fn(tx, row) };
    });
    if (expired || !result) throw new AppError('challenge.closed', 409);
    return result.value;
  }

  /** Accepter : seul le joueur qui doit répondre ; mises bloquées, salon privé, partie lancée. */
  async accept(actor: ChallengeActor, id: string): Promise<void> {
    await this.pending(id, actor.userId, async (tx, row) => {
      if (row.awaiting !== actor.userId) throw new AppError('challenge.not_yours', 403);
      if (await isBlocked(tx, row.from_user_id, row.to_user_id)) throw new AppError('challenge.blocked', 403);
      const players: [{ userId: string }, { userId: string }] = [{ userId: row.from_user_id }, { userId: row.to_user_id }];
      const names = await pseudos(tx, [row.from_user_id, row.to_user_id]);
      const isLudo = gameOfVariant(row.variant) === 'ludo';
      const { code, gameId } = await this.deps.rooms.startPrivateTable(tx, {
        variant: row.variant,
        format: row.format,
        clock: row.clock_base_ms !== null ? { initialMs: row.clock_base_ms, incrementMs: row.clock_inc_ms ?? 0 } : null,
        turnMs: isLudo ? DEFAULT_ROOM_TURN_MS : null,
        stake: row.stake,
        ranked: !isFriendly(row.variant),
        name: `${names.get(row.from_user_id) ?? '?'} · ${names.get(row.to_user_id) ?? '?'}`.slice(0, 30),
        players,
      });
      await tx.query(
        `UPDATE challenges SET status = 'accepted', awaiting = NULL, room_id = (SELECT id FROM rooms WHERE code = $2 AND status <> 'closed'), game_id = $3 WHERE id = $1`,
        [id, code, gameId],
      );
      const other = actor.userId === row.from_user_id ? row.to_user_id : row.from_user_id;
      await this.deps.notifications.notify(
        tx,
        other,
        'invites.challenge_accepted',
        { from: actor.pseudo ?? '?', fromUserId: actor.userId, challengeId: id, gameId, code },
        { push: 'always' },
      );
    });
  }

  /** Contre-proposition de mise : c'est ensuite à l'autre de répondre (2 h de plus). */
  async counter(actor: ChallengeActor, id: string, stake: number): Promise<void> {
    await this.pending(id, actor.userId, async (tx, row) => {
      if (row.awaiting !== actor.userId) throw new AppError('challenge.not_yours', 403);
      if (stake === row.stake) return;
      if (stake > 0 && isFriendly(row.variant)) throw new AppError('room.invalid_settings', 400, { reason: 'friendly_stake' });
      const now = this.now();
      await assertStake(tx, [row.from_user_id, row.to_user_id], row.variant, stake, now, actor.userId);
      const other = actor.userId === row.from_user_id ? row.to_user_id : row.from_user_id;
      await tx.query('UPDATE challenges SET stake = $2, awaiting = $3, countered = true, expires_at = $4 WHERE id = $1', [
        id,
        stake,
        other,
        new Date(now.getTime() + CHALLENGE_TTL_MS),
      ]);
      await this.deps.notifications.notify(
        tx,
        other,
        'invites.challenge_countered',
        { from: actor.pseudo ?? '?', fromUserId: actor.userId, challengeId: id, stake },
        { push: 'always' },
      );
    });
  }

  /** Refuser : le joueur qui doit répondre. */
  async decline(actor: ChallengeActor, id: string): Promise<void> {
    await this.pending(id, actor.userId, async (tx, row) => {
      if (row.awaiting !== actor.userId) throw new AppError('challenge.not_yours', 403);
      await tx.query(`UPDATE challenges SET status = 'declined', awaiting = NULL WHERE id = $1`, [id]);
      const other = actor.userId === row.from_user_id ? row.to_user_id : row.from_user_id;
      await this.deps.notifications.notify(tx, other, 'invites.challenge_declined', { from: actor.pseudo ?? '?', fromUserId: actor.userId, challengeId: id });
    });
  }

  /** Retirer : le joueur qui attend la réponse (auteur de la dernière proposition). */
  async cancel(actor: ChallengeActor, id: string): Promise<void> {
    await this.pending(id, actor.userId, async (tx, row) => {
      if (row.awaiting === actor.userId) throw new AppError('challenge.not_yours', 403);
      await tx.query(`UPDATE challenges SET status = 'cancelled', awaiting = NULL WHERE id = $1`, [id]);
    });
  }

  /** Défis sans réponse depuis 2 h. */
  async expire(now: Date): Promise<number> {
    const r = await this.deps.db.query(`UPDATE challenges SET status = 'expired', awaiting = NULL WHERE status = 'pending' AND expires_at <= $1`, [now]);
    return r.rowCount ?? 0;
  }
}
