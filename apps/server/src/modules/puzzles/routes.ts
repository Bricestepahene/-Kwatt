/**
 * Routes /v1/puzzles (écran 19b, profils seulement) :
 *   GET  /v1/puzzles/daily?variant=dames10|dames8
 *   POST /v1/puzzles/daily/solve { dayKey, variant?, moves }
 */
import {
  DailyPuzzleQuerySchema,
  DailyPuzzleSolveRequestSchema,
  type DailyPuzzleResponse,
  type DailyPuzzleSolveResponse,
} from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { RewardsService } from '../rewards/service.js';
import { dailyFor, solveDaily } from './service.js';

const puzzlesRoutes: FastifyPluginAsync = async (app) => {
  const rewards = new RewardsService({ db: app.db, clock: app.clock, log: app.log, notifications: app.notifications });

  app.get('/v1/puzzles/daily', { preHandler: app.requireMember }, async (req): Promise<DailyPuzzleResponse> => {
    const { variant } = parse(DailyPuzzleQuerySchema, req.query);
    return dailyFor(app.db, requireAuth(req).userId, variant, app.clock.now());
  });

  app.post(
    '/v1/puzzles/daily/solve',
    { preHandler: app.requireMember, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req): Promise<DailyPuzzleSolveResponse> => {
      const body = parse(DailyPuzzleSolveRequestSchema, req.body);
      const userId = requireAuth(req).userId;
      const res = await solveDaily(app.db, userId, body, app.clock.now());
      // Un problème du jour tenté compte pour la série de jours (écran 40).
      await rewards.recordActivity(userId).catch((err: unknown) => app.log.error({ err, userId }, 'série de jours non notée'));
      return res;
    },
  );

  app.accounts.addExportSection('puzzles', async (db, userId) => {
    const r = await db.query(`SELECT day, variant, puzzle_id AS "puzzleId", solved_at AS "solvedAt" FROM puzzle_solves WHERE user_id = $1 ORDER BY day`, [
      userId,
    ]);
    return r.rows;
  });

  app.accounts.onErase('puzzles', async (tx, userId) => {
    await tx.query('DELETE FROM puzzle_solves WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM puzzle_attempts WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM puzzle_streaks WHERE user_id = $1', [userId]);
  });
};

export default puzzlesRoutes;
