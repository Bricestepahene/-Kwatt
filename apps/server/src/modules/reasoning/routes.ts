/**
 * Raisonnement en bêta (écran 42) : « Me prévenir à l'ouverture » (liste d'attente).
 * Voir @kwatt/protocol (http/progression.ts).
 */
import type { ReasoningWaitlist } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from '../../db/pool.js';
import { requireAuth } from '../auth/plugin.js';

async function waitlist(db: Sql, userId: string): Promise<ReasoningWaitlist> {
  const r = await db.query<{ joined: boolean; count: number }>(
    'SELECT EXISTS (SELECT 1 FROM reasoning_waitlist WHERE user_id = $1) AS joined, (SELECT count(*)::int FROM reasoning_waitlist) AS count',
    [userId],
  );
  return r.rows[0] ?? { joined: false, count: 0 };
}

const reasoningRoutes: FastifyPluginAsync = async (app) => {
  const member = { preHandler: app.requireMember };

  app.get('/v1/reasoning/waitlist', member, async (req) => waitlist(app.db, requireAuth(req).userId));

  app.post('/v1/reasoning/waitlist', member, async (req) => {
    const userId = requireAuth(req).userId;
    await app.db.query('INSERT INTO reasoning_waitlist (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    return waitlist(app.db, userId);
  });

  app.delete('/v1/reasoning/waitlist', member, async (req) => {
    const userId = requireAuth(req).userId;
    await app.db.query('DELETE FROM reasoning_waitlist WHERE user_id = $1', [userId]);
    return waitlist(app.db, userId);
  });
};

export default reasoningRoutes;
