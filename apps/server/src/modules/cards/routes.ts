/**
 * Routes de la collection de cartes (écran 39) : voir @kwatt/protocol (http/progression.ts).
 */
import { EquipCardRequestSchema, type CardCollection } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { collection, equip } from './service.js';

const cardsRoutes: FastifyPluginAsync = async (app) => {
  const member = { preHandler: app.requireMember };

  app.get('/v1/cards', member, async (req): Promise<CardCollection> => collection(app.db, requireAuth(req).userId));

  app.put('/v1/cards/equipped', member, async (req): Promise<CardCollection> => {
    const body = parse(EquipCardRequestSchema, req.body);
    const userId = requireAuth(req).userId;
    await equip(app.db, userId, body.slot, body.code);
    return collection(app.db, userId);
  });
};

export default cardsRoutes;
