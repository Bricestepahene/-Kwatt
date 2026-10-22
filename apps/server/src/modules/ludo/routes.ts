/**
 * Routes /v1/ludo : jeux de règles maison enregistrés (écran 20b). Profils seulement.
 *
 *   GET    /v1/ludo/house-rules
 *   POST   /v1/ludo/house-rules          { name, preset, rules } → 201
 *   GET    /v1/ludo/house-rules/:id
 *   PUT    /v1/ludo/house-rules/:id      { name?, preset?, rules? }
 *   DELETE /v1/ludo/house-rules/:id
 */
import {
  CreateHouseRuleSetRequestSchema,
  UpdateHouseRuleSetRequestSchema,
  UuidSchema,
  type HouseRuleSet,
  type HouseRuleSetList,
} from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { createHouseRuleSet, deleteHouseRuleSet, listHouseRuleSets, loadHouseRuleSet, updateHouseRuleSet } from './service.js';

const IdParamsSchema = z.object({ id: UuidSchema });

const ludoRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/ludo/house-rules', { preHandler: app.requireMember }, async (req): Promise<HouseRuleSetList> => {
    return { items: await listHouseRuleSets(app.db, requireAuth(req).userId) };
  });

  app.post('/v1/ludo/house-rules', { preHandler: app.requireMember }, async (req, reply): Promise<HouseRuleSet> => {
    const body = parse(CreateHouseRuleSetRequestSchema, req.body);
    const created = await createHouseRuleSet(app.db, requireAuth(req).userId, body);
    reply.code(201);
    return created;
  });

  app.get('/v1/ludo/house-rules/:id', { preHandler: app.requireMember }, async (req): Promise<HouseRuleSet> => {
    const { id } = parse(IdParamsSchema, req.params);
    return loadHouseRuleSet(app.db, requireAuth(req).userId, id);
  });

  app.put('/v1/ludo/house-rules/:id', { preHandler: app.requireMember }, async (req): Promise<HouseRuleSet> => {
    const { id } = parse(IdParamsSchema, req.params);
    const body = parse(UpdateHouseRuleSetRequestSchema, req.body);
    return updateHouseRuleSet(app.db, requireAuth(req).userId, id, body);
  });

  app.delete('/v1/ludo/house-rules/:id', { preHandler: app.requireMember }, async (req) => {
    const { id } = parse(IdParamsSchema, req.params);
    await deleteHouseRuleSet(app.db, requireAuth(req).userId, id);
    return { ok: true as const };
  });

  // Export des données : les jeux de règles du joueur.
  app.accounts.addExportSection('ludo_house_rules', async (db, userId) => listHouseRuleSets(db, userId));

  // Effacement à J+30 (la clé étrangère le ferait aussi : on reste explicite).
  app.accounts.onErase('ludo_house_rules', async (tx, userId) => {
    await tx.query('DELETE FROM house_rule_sets WHERE owner_id = $1', [userId]);
  });
};

export default ludoRoutes;
