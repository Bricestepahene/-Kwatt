/**
 * Liens entre joueurs (contrat C6) : amis et blocages. Exposé aux autres modules :
 *   isBlocked(db, a, b)   true si l'un a bloqué l'autre (invitations, défis, messages refusés)
 *   areFriends(db, a, b)  amitié acceptée
 *   friendIds(db, userId) amis acceptés (présence, invitations)
 */
import type { Sql } from '../../db/pool.js';

export function pairOf(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function isBlocked(db: Sql, a: string, b: string): Promise<boolean> {
  const r = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
    [a, b],
  );
  return (r.rows[0]?.n ?? 0) > 0;
}

export async function areFriends(db: Sql, a: string, b: string): Promise<boolean> {
  const [x, y] = pairOf(a, b);
  const r = await db.query("SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2 AND status = 'accepted'", [x, y]);
  return (r.rowCount ?? 0) > 0;
}

export async function friendIds(db: Sql, userId: string): Promise<string[]> {
  const r = await db.query<{ id: string }>(
    `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS id
       FROM friendships WHERE (user_a = $1 OR user_b = $1) AND status = 'accepted'`,
    [userId],
  );
  return r.rows.map((x) => x.id);
}
