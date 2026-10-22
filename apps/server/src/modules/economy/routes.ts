/**
 * Routes /v1/wallet : solde et journal des cauris du joueur connecté.
 */
import { PaginationQuerySchema } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { getBalance, journal } from './service.js';

const economyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/wallet', { preHandler: app.authenticate }, async (req) => {
    return { balance: await getBalance(app.db, requireAuth(req).userId) };
  });

  app.get('/v1/wallet/journal', { preHandler: app.authenticate }, async (req) => {
    const q = parse(PaginationQuerySchema, req.query);
    return journal(app.db, requireAuth(req).userId, q.cursor, q.limit);
  });
};

export default economyRoutes;
