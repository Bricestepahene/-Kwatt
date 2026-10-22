/**
 * Routes /v1/notifications : liste, lecture, réglages, jetons push.
 */
import {
  MarkReadRequestSchema,
  NotificationPreferencesPatchSchema,
  PaginationQuerySchema,
  PushTokenRequestSchema,
} from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { DAY } from '../../lib/clock.js';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';

/** Les notifications lues de plus de 90 jours sont purgées. */
const KEEP_READ_DAYS = 90;

const notificationRoutes: FastifyPluginAsync = async (app) => {
  const service = app.notifications;

  app.get('/v1/notifications', { preHandler: app.authenticate }, async (req) => {
    const q = parse(PaginationQuerySchema, req.query);
    return service.list(requireAuth(req).userId, q.cursor, q.limit);
  });

  app.post('/v1/notifications/read', { preHandler: app.authenticate }, async (req) => {
    const body = parse(MarkReadRequestSchema, req.body);
    return { unreadCount: await service.markRead(requireAuth(req).userId, body.ids, body.all === true) };
  });

  app.get('/v1/notifications/preferences', { preHandler: app.authenticate }, async (req) => {
    return service.getPreferences(requireAuth(req).userId);
  });

  app.put('/v1/notifications/preferences', { preHandler: app.authenticate }, async (req) => {
    const body = parse(NotificationPreferencesPatchSchema, req.body);
    return service.updatePreferences(requireAuth(req).userId, body);
  });

  app.post('/v1/notifications/push-token', { preHandler: app.authenticate }, async (req) => {
    const body = parse(PushTokenRequestSchema, req.body);
    const auth = requireAuth(req);
    await service.registerPushToken(auth.userId, auth.deviceId, body.token);
    return { ok: true };
  });

  app.delete('/v1/notifications/push-token', { preHandler: app.authenticate }, async (req) => {
    const body = parse(PushTokenRequestSchema, req.body);
    await service.removePushToken(requireAuth(req).userId, body.token);
    return { ok: true };
  });

  app.registerJob('notifications.purge_old', DAY, async ({ db, now }) => {
    await db.query('DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < $1', [
      new Date(now.getTime() - KEEP_READ_DAYS * DAY),
    ]);
  });
};

export default notificationRoutes;
