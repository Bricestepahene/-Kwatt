/**
 * Routes des récompenses (écran 40) : voir @kwatt/protocol (http/progression.ts). Branche
 * aussi les fins de partie (série, quêtes, victoires marquantes) et les médailles de ligue.
 */
import { ChooseCardRequestSchema, type ClaimResult, type RewardsView } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MINUTE } from '../../lib/clock.js';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { RewardsService } from './service.js';

const rewardsRoutes: FastifyPluginAsync = async (app) => {
  const rewards = new RewardsService({ db: app.db, clock: app.clock, log: app.log, notifications: app.notifications });
  const member = { preHandler: app.requireMember };
  const write = { ...member, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.games.onGameFinished((event) => rewards.onGameFinished(event));

  app.get('/v1/rewards', member, async (req): Promise<RewardsView> => rewards.view(requireAuth(req).userId));

  app.post('/v1/rewards/quests/:id/claim', write, async (req): Promise<ClaimResult> => {
    const { id } = parse(z.object({ id: z.string().min(1).max(40) }), req.params);
    return rewards.claim(requireAuth(req).userId, id);
  });

  app.post('/v1/rewards/streak/choose', write, async (req): Promise<ClaimResult> => {
    const { code } = parse(ChooseCardRequestSchema, req.body);
    return rewards.chooseStreakCard(requireAuth(req).userId, code);
  });

  app.accounts.onErase('rewards', async (tx, userId) => {
    await tx.query('DELETE FROM day_streaks WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM quest_events WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM reasoning_waitlist WHERE user_id = $1', [userId]);
  });

  app.registerJob('rewards.medal_cards', 10 * MINUTE, async () => {
    await rewards.grantMedalCards();
  });
};

export default rewardsRoutes;
