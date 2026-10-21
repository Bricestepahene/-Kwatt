/**
 * Point d'entrée temps réel : GET /v1/ws?token=<jeton d'accès> (SPEC §9).
 * Jeton absent ou invalide : réponse HTTP 401 avant l'ouverture de la WebSocket.
 *
 * Présence : à chaque passage en ligne / hors ligne, `users.last_seen_at` est mis à jour et
 * les joueurs renvoyés par `app.realtime.setPresenceAudience(fn)` (les amis, fournis par le
 * module Amis) reçoivent `presence.update`.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { authFromToken } from '../modules/auth/plugin.js';

const WsQuerySchema = z.object({ token: z.string().min(1).max(4096).optional() });

const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.realtime.onPresenceChange(async (userId, online, at) => {
    await app.db.query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [userId, at]);
    const recipients = await app.realtime.presenceAudience(userId);
    if (recipients.length === 0) return;
    app.realtime.sendToUsers(recipients, {
      t: 'presence.update',
      users: [{ userId, online, lastSeenAt: online ? null : at.toISOString() }],
    });
  });

  app.get(
    '/v1/ws',
    {
      websocket: true,
      preValidation: async (req) => {
        const { token } = parse(WsQuerySchema, req.query);
        if (!token) throw new AppError('auth.required', 401);
        req.auth = await authFromToken(app, token);
      },
    },
    (socket, req) => {
      const auth = req.auth;
      if (!auth) {
        socket.close(4401, 'unauthorized');
        return;
      }
      app.realtime.attach(socket, { userId: auth.userId, sessionId: auth.sessionId, locale: auth.locale });
    },
  );
};

export default realtimeRoutes;
