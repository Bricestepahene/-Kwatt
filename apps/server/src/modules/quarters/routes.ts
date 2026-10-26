/**
 * Routes de la guerre des quartiers (écran 36) : voir @kwatt/protocol (http/progression.ts).
 * Les quartiers eux-mêmes (/v1/quarters, /v1/me/quarter) sont au module accounts.
 */
import { QuarterStandingsQuerySchema, type QuarterStandings } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { HOUR, MINUTE } from '../../lib/clock.js';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { QuartersService } from './service.js';

const quartersRoutes: FastifyPluginAsync = async (app) => {
  const quarters = new QuartersService({ db: app.db, clock: app.clock, log: app.log, notifications: app.notifications });

  app.games.onGameFinished((event) => quarters.onGameFinished(event));

  app.get('/v1/quarters/standings', { preHandler: app.requireMember }, async (req): Promise<QuarterStandings> => {
    const { scope } = parse(QuarterStandingsQuerySchema, req.query);
    return quarters.standings(requireAuth(req).userId, scope);
  });

  app.registerJob('quarters.snapshot', 10 * MINUTE, async () => {
    await quarters.snapshot();
  });
  app.registerJob('quarters.close_season', HOUR, async () => {
    await quarters.closeSeasons();
  });
};

export default quartersRoutes;
