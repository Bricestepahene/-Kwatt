/**
 * Routes /v1/ratings (contrat C1) :
 *   GET /v1/ratings/me → { items: [{ variant, rating, level, rank, gamesPlayed, wins, draws, losses, pointsToNextLevel }] }
 *
 * Les autres modules mettent la force à jour avec `recordRatedResult` (service.ts).
 */
import type { MyRatingsResponse } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { myRatings } from './service.js';

const ratingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/ratings/me', { preHandler: app.requireMember }, async (req): Promise<MyRatingsResponse> => {
    return { items: await myRatings(app.db, requireAuth(req).userId) };
  });

  app.accounts.addExportSection('ratings', async (db, userId) => myRatings(db, userId));
};

export default ratingsRoutes;
