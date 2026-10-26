/**
 * Routes « Signaler ou bloquer » (écran 38) : voir @kwatt/protocol (http/reports.ts).
 * Profils seulement ; la file de modération passe par ADMIN_TOKEN (module admin).
 */
import {
  BlockRequestSchema,
  ReportRequestSchema,
  ResolveReportRequestSchema,
  type BlockListResponse,
  type ReportContext,
  type ReportResult,
} from '@kwatt/protocol';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { bearerToken } from '../auth/context.js';
import { requireAuth } from '../auth/plugin.js';
import { ReportsService } from './service.js';

const UserParamSchema = z.object({ userId: z.uuid() });

const reportsRoutes: FastifyPluginAsync = async (app) => {
  const reports = new ReportsService({ db: app.db, clock: app.clock, media: app.media, notifications: app.notifications });
  const member = { preHandler: app.requireMember };
  const me = (req: FastifyRequest) => requireAuth(req).userId;
  const other = (req: FastifyRequest) => parse(UserParamSchema, req.params).userId;

  app.get('/v1/reports/context/:userId', member, async (req): Promise<ReportContext> => reports.context(me(req), other(req)));

  app.post('/v1/reports', { ...member, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply): Promise<ReportResult> => {
    const result = await reports.report(me(req), parse(ReportRequestSchema, req.body));
    reply.code(201);
    return result;
  });

  app.get('/v1/blocks', member, async (req): Promise<BlockListResponse> => ({ items: await reports.blocks(me(req)) }));

  app.post('/v1/blocks', member, async (req) => {
    await reports.block(me(req), parse(BlockRequestSchema, req.body).userId);
    return { ok: true };
  });

  app.delete('/v1/blocks/:userId', member, async (req) => {
    await reports.unblock(me(req), other(req));
    return { ok: true };
  });

  // Modération (ADMIN_TOKEN, comme /v1/admin du module admin) ----------------------------
  const adminToken = app.config.adminToken;
  if (adminToken) {
    const guard = async (req: FastifyRequest) => {
      const header = req.headers['x-admin-token'];
      const given = bearerToken(req.headers.authorization) ?? (typeof header === 'string' ? header : null);
      if (!given || !safeEqual(given, adminToken)) throw new AppError('common.forbidden', 403);
    };
    const opts = { preHandler: guard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

    app.get('/v1/admin/reports', opts, async (req) => {
      const q = parse(z.object({ status: z.enum(['open', 'closed']).default('open') }), req.query);
      return { items: await reports.queue(q.status) };
    });
    app.post('/v1/admin/reports/:id/resolve', opts, async (req) => {
      const { id } = parse(z.object({ id: z.uuid() }), req.params);
      const body = parse(ResolveReportRequestSchema, req.body);
      await reports.resolve(id, body.decision, body.note);
      return { ok: true };
    });
  }
};

export default reportsRoutes;
