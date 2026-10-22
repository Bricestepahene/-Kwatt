/**
 * Routes /v1/admin, protégées par ADMIN_TOKEN (`Authorization: Bearer <ADMIN_TOKEN>` ou
 * en-tête `x-admin-token`). Sans ADMIN_TOKEN, ces routes n'existent pas (404).
 *
 *   GET  /v1/admin/stats
 *   GET  /v1/admin/users?q=
 *   POST /v1/admin/users/:id/birth-year      { birthYear }
 *   POST /v1/admin/users/:id/verify-email
 *   POST /v1/admin/users/:id/revoke-sessions
 *   POST /v1/admin/users/:id/cancel-deletion
 *   POST /v1/admin/users/:id/adjust          { amount, reason, idempotencyKey }
 *   POST /v1/admin/jobs/:name/run
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { bearerToken } from '../auth/context.js';
import {
  adjustBalance,
  cancelDeletion,
  findUsers,
  markEmailVerified,
  revokeAllSessions,
  setBirthYear,
  stats,
} from './service.js';

const IdParams = z.object({ id: z.uuid() });

const adminRoutes: FastifyPluginAsync = async (app) => {
  const token = app.config.adminToken;
  if (!token) return;

  const guard = async (req: FastifyRequest) => {
    const given = bearerToken(req.headers.authorization) ?? (typeof req.headers['x-admin-token'] === 'string' ? req.headers['x-admin-token'] : null);
    if (!given || !safeEqual(given, token)) throw new AppError('common.forbidden', 403);
  };
  const opts = { preHandler: guard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  app.get('/v1/admin/stats', opts, async () => ({ ...(await stats(app.db)), online: app.realtime.onlineUserIds().length }));

  app.get('/v1/admin/users', opts, async (req) => {
    const { q } = parse(z.object({ q: z.string().min(1).max(254) }), req.query);
    return { items: await findUsers(app.db, q) };
  });

  app.post('/v1/admin/users/:id/birth-year', opts, async (req) => {
    const { id } = parse(IdParams, req.params);
    const { birthYear } = parse(z.object({ birthYear: z.number().int() }), req.body);
    await setBirthYear(app.db, id, birthYear, app.clock.now());
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/verify-email', opts, async (req) => {
    const { id } = parse(IdParams, req.params);
    await markEmailVerified(app.db, id, app.clock.now());
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/revoke-sessions', opts, async (req) => {
    const { id } = parse(IdParams, req.params);
    const revoked = await revokeAllSessions(app.db, id, app.clock.now());
    app.realtime.closeUser(id);
    return { revoked: revoked.length };
  });

  app.post('/v1/admin/users/:id/cancel-deletion', opts, async (req) => {
    const { id } = parse(IdParams, req.params);
    return { cancelled: await cancelDeletion(app.db, id) };
  });

  app.post('/v1/admin/users/:id/adjust', opts, async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(
      z.object({ amount: z.number().int(), reason: z.string().min(1).max(200), idempotencyKey: z.string().min(1).max(100) }),
      req.body,
    );
    return adjustBalance(app.db, id, body.amount, body.reason, body.idempotencyKey);
  });

  app.post('/v1/admin/jobs/:name/run', opts, async (req) => {
    const { name } = parse(z.object({ name: z.string().min(1).max(64) }), req.params);
    if (!app.jobs.names().includes(name)) throw new AppError('common.not_found', 404);
    return { ran: await app.jobs.runNow(name) };
  });
};

export default adminRoutes;
