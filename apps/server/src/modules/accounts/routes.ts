/**
 * Module « accounts » (équipe Comptes) : quartiers et nom de partie des invités.
 * L'authentification (modules/auth) et le profil minimal (modules/me) sont réutilisés tels quels.
 *
 *   GET /v1/quarters?q=&country=&limit=   session    → { items: Quarter[] }
 *   GET /v1/quarters/:id                  session    → Quarter
 *   GET /v1/me/quarter                    profil     → MyQuarterResponse
 *   PUT /v1/me/quarter                    profil     { quarterId } → MyQuarterResponse
 *   GET /v1/me/display-name               session    → { displayName }
 *   PUT /v1/me/display-name               session    { displayName } → { displayName }
 */
import {
  DisplayNameRequestSchema,
  QuarterIdSchema,
  QuarterSearchQuerySchema,
  SetQuarterRequestSchema,
} from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { AccountsService } from './service.js';

const QuarterParamsSchema = z.object({ id: QuarterIdSchema });

const accountsRoutes: FastifyPluginAsync = async (app) => {
  const service = new AccountsService(app);
  // Recherche à chaque frappe (avec un délai côté appli) : limite large mais bornée.
  const search = { rateLimit: { max: 120, timeWindow: '1 minute' } };

  app.get('/v1/quarters', { preHandler: app.authenticate, config: search }, async (req) => {
    const query = parse(QuarterSearchQuerySchema, req.query);
    return { items: await service.search(query) };
  });

  app.get('/v1/quarters/:id', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(QuarterParamsSchema, req.params);
    return service.quarter(id);
  });

  app.get('/v1/me/quarter', { preHandler: app.requireMember }, async (req) => service.myQuarter(requireAuth(req)));

  app.put('/v1/me/quarter', { preHandler: app.requireMember }, async (req) => {
    const body = parse(SetQuarterRequestSchema, req.body);
    return service.setQuarter(requireAuth(req), body.quarterId);
  });

  app.get('/v1/me/display-name', { preHandler: app.authenticate }, async (req) => service.displayName(requireAuth(req)));

  app.put('/v1/me/display-name', { preHandler: app.authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(DisplayNameRequestSchema, req.body);
    return service.setDisplayName(requireAuth(req), body.displayName);
  });

  // Effacement à J+30 : le nom de partie part avec le compte (le profil, et donc le quartier,
  // est supprimé par modules/me).
  app.accounts.onErase('accounts', async (tx, userId) => {
    await tx.query('UPDATE users SET display_name = NULL WHERE id = $1', [userId]);
  });

  // Export des données : quartier lisible et nom de partie.
  app.accounts.addExportSection('quarter', async (db, userId) => {
    const r = await db.query(
      `SELECT q.id, q.country, q.city, q.name, p.quarter_since AS "since", p.quarter_changed_at AS "changedAt"
         FROM profiles p JOIN quarters q ON q.id = p.quarter WHERE p.user_id = $1`,
      [userId],
    );
    return r.rows[0] ?? null;
  });
  app.accounts.addExportSection('displayName', async (db, userId) => {
    const r = await db.query<{ display_name: string | null }>('SELECT display_name FROM users WHERE id = $1', [userId]);
    return r.rows[0]?.display_name ?? null;
  });
};

export default accountsRoutes;
