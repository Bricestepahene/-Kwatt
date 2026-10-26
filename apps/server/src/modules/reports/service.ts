/**
 * Signaler ou bloquer (écran 38) et file de modération.
 *
 * Un signalement joint d'office la dernière partie jouée ensemble (la modération revoit chaque
 * coup). « Bloquer aussi » coupe l'amitié et les demandes : le bloqué ne peut plus inviter,
 * défier ni écrire (isBlocked, friends/relations.ts). On ne lui dit jamais qu'il est bloqué.
 */
import {
  REPORTS_PER_DAY,
  type BlockedPlayer,
  type ReportContext,
  type ReportGame,
  type ReportReason,
  type ReportResult,
} from '@kwatt/protocol';
import { transaction, type Pool, type Sql } from '../../db/pool.js';
import { DAY, type Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { MediaStore } from '../media/store.js';
import type { NotificationService } from '../notifications/service.js';
import { loadLooks } from '../profiles/look.js';
import { pairOf } from '../friends/relations.js';

export interface ReportsDeps {
  db: Pool;
  clock: Clock;
  media: MediaStore;
  notifications: NotificationService;
}


async function assertProfile(db: Sql, userId: string): Promise<void> {
  const r = await db.query('SELECT 1 FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1 AND u.erased_at IS NULL', [userId]);
  if ((r.rowCount ?? 0) === 0) throw new AppError('report.not_found', 404);
}

/** Bloque `blocked` pour `blocker` : amitié et demandes défaites. Idempotent. */
export async function block(db: Sql, blocker: string, blocked: string, at: Date): Promise<void> {
  const [a, b] = pairOf(blocker, blocked);
  await db.query('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [blocker, blocked, at]);
  await db.query('DELETE FROM friendships WHERE user_a = $1 AND user_b = $2', [a, b]);
}

export class ReportsService {
  constructor(private readonly deps: ReportsDeps) {}

  /** Dernière partie jouée ensemble (terminée ou en cours). */
  async lastSharedGame(a: string, b: string, gameId?: string): Promise<ReportGame | null> {
    const r = await this.deps.db.query<{ id: string; variant: string; at: Date }>(
      `SELECT g.id, g.variant::text AS variant, COALESCE(g.ended_at, g.started_at) AS at
         FROM games g
         JOIN game_players x ON x.game_id = g.id AND x.user_id = $1
         JOIN game_players y ON y.game_id = g.id AND y.user_id = $2
        WHERE g.started_at IS NOT NULL AND ($3::uuid IS NULL OR g.id = $3)
        ORDER BY COALESCE(g.ended_at, g.started_at) DESC LIMIT 1`,
      [a, b, gameId ?? null],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { gameId: row.id, family: row.variant.startsWith('dames') ? 'dames' : 'ludo', variant: row.variant, playedAt: row.at.toISOString() };
  }

  async context(userId: string, otherId: string): Promise<ReportContext> {
    if (userId === otherId) throw new AppError('report.self', 400);
    await assertProfile(this.deps.db, otherId);
    const blocked = await this.deps.db.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [userId, otherId]);
    const pending = await this.deps.db.query("SELECT 1 FROM reports WHERE reporter_id = $1 AND reported_id = $2 AND status = 'open'", [userId, otherId]);
    return {
      userId: otherId,
      game: await this.lastSharedGame(userId, otherId),
      blocked: (blocked.rowCount ?? 0) > 0,
      pending: (pending.rowCount ?? 0) > 0,
    };
  }

  async report(
    reporterId: string,
    input: { userId: string; reason: ReportReason; message?: string | undefined; gameId?: string | undefined; block: boolean },
  ): Promise<ReportResult> {
    if (reporterId === input.userId) throw new AppError('report.self', 400);
    await assertProfile(this.deps.db, input.userId);
    const now = this.deps.clock.now();
    const game = await this.lastSharedGame(reporterId, input.userId, input.gameId);
    return transaction(this.deps.db, async (tx) => {
      const today = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM reports WHERE reporter_id = $1 AND created_at > $2', [reporterId, new Date(now.getTime() - DAY)]);
      if ((today.rows[0]?.n ?? 0) >= REPORTS_PER_DAY) throw new AppError('report.rate_limited', 429, { max: REPORTS_PER_DAY });
      const r = await tx.query<{ id: string }>(
        `INSERT INTO reports (reporter_id, reported_id, reason, message, game_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id`,
        [reporterId, input.userId, input.reason, input.message?.trim() || null, game?.gameId ?? null, now],
      );
      const id = r.rows[0]?.id;
      if (!id) throw new AppError('report.already_open', 409);
      if (input.block) await block(tx, reporterId, input.userId, now);
      return { reportId: id, gameId: game?.gameId ?? null, blocked: input.block };
    });
  }

  async block(userId: string, otherId: string): Promise<void> {
    if (userId === otherId) throw new AppError('report.self', 400);
    await assertProfile(this.deps.db, otherId);
    await block(this.deps.db, userId, otherId, this.deps.clock.now());
  }

  async unblock(userId: string, otherId: string): Promise<void> {
    await this.deps.db.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [userId, otherId]);
  }

  async blocks(userId: string): Promise<BlockedPlayer[]> {
    const r = await this.deps.db.query<{ id: string; pseudo: string; created_at: Date }>(
      `SELECT b.blocked_id AS id, COALESCE(p.pseudo::text, '') AS pseudo, b.created_at
         FROM blocks b LEFT JOIN profiles p ON p.user_id = b.blocked_id
        WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
      [userId],
    );
    const looks = await loadLooks(this.deps.db, this.deps.media, r.rows.map((x) => x.id), userId);
    return r.rows.map((x) => ({ userId: x.id, pseudo: x.pseudo, avatar: looks.get(x.id) ?? null, blockedAt: x.created_at.toISOString() }));
  }

  // --- Modération ---------------------------------------------------------------

  async queue(status: 'open' | 'closed'): Promise<unknown[]> {
    const r = await this.deps.db.query(
      `SELECT r.id, r.reason, r.message, r.game_id AS "gameId", r.status, r.created_at AS "createdAt", r.resolved_at AS "resolvedAt", r.note,
              r.reporter_id AS "reporterId", rp.pseudo::text AS "reporterPseudo",
              r.reported_id AS "reportedId", dp.pseudo::text AS "reportedPseudo",
              (SELECT count(*)::int FROM reports o WHERE o.reported_id = r.reported_id) AS "reportsAgainst"
         FROM reports r
         LEFT JOIN profiles rp ON rp.user_id = r.reporter_id
         LEFT JOIN profiles dp ON dp.user_id = r.reported_id
        WHERE ${status === 'open' ? "r.status = 'open'" : "r.status <> 'open'"}
        ORDER BY r.created_at ${status === 'open' ? 'ASC' : 'DESC'} LIMIT 100`,
    );
    return r.rows;
  }

  async resolve(id: string, decision: 'dismissed' | 'warned' | 'actioned', note?: string): Promise<void> {
    await transaction(this.deps.db, async (tx) => {
      const r = await tx.query<{ reported_id: string; reason: string }>(
        `UPDATE reports SET status = $2, note = $3, resolved_at = $4 WHERE id = $1 AND status = 'open' RETURNING reported_id, reason`,
        [id, decision, note ?? null, this.deps.clock.now()],
      );
      const row = r.rows[0];
      if (!row) throw new AppError('report.not_found', 404);
      if (decision === 'warned') await this.deps.notifications.notify(tx, row.reported_id, 'account.warning', { reason: row.reason });
    });
  }
}
