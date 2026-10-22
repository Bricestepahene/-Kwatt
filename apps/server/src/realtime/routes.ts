/**
 * Point d'entrée temps réel : GET /v1/ws?token=<jeton d'accès> (SPEC §9).
 * Jeton absent ou invalide : réponse HTTP 401 avant l'ouverture de la WebSocket.
 *
 * Présence : à chaque passage en ligne / hors ligne, `users.last_seen_at` est mis à jour et
 * les joueurs renvoyés par `app.realtime.setPresenceAudience(fn)` (les amis, fournis par le
 * module Amis) reçoivent `presence.update`. À l'ouverture, le joueur reçoit l'état de ces
 * mêmes amis (qui est en ligne, vu pour la dernière fois quand).
 *
 * Sessions : une session fermée ailleurs (CLI d'administration, autre processus) coupe ses
 * WebSocket au contrôle suivant (toutes les minutes).
 */
import type { PresenceEntry } from '@kwatt/protocol';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MINUTE } from '../lib/clock.js';
import { AppError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { authFromToken } from '../modules/auth/plugin.js';

const WsQuerySchema = z.object({ token: z.string().min(1).max(4096).optional() });

/** Intervalle du contrôle des sessions des connexions ouvertes. */
export const SESSION_CHECK_INTERVAL_MS = MINUTE;

/**
 * Coupe les connexions dont la session a été fermée (ou le compte effacé) entre-temps ;
 * rend le nombre de sessions coupées.
 */
export async function closeRevokedSockets(app: FastifyInstance): Promise<number> {
  const ids = app.realtime.sessionIds();
  if (ids.length === 0) return 0;
  const r = await app.db.query<{ id: string }>(
    `SELECT s.id FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ANY($1::uuid[]) AND (s.revoked_at IS NOT NULL OR u.erased_at IS NOT NULL)`,
    [ids],
  );
  for (const row of r.rows) app.realtime.closeSession(row.id);
  return r.rows.length;
}

const realtimeRoutes: FastifyPluginAsync = async (app) => {
  const hub = app.realtime;

  hub.onPresenceChange(async (userId, online, at) => {
    await app.db.query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [userId, at]);
    const recipients = await hub.presenceAudience(userId);
    if (recipients.length === 0) return;
    hub.sendToUsers(recipients, {
      t: 'presence.update',
      users: [{ userId, online, lastSeenAt: online ? null : at.toISOString() }],
    });
  });

  /** État de présence des amis de `userId`, envoyé à l'ouverture de sa connexion. */
  async function presenceSnapshot(userId: string): Promise<PresenceEntry[]> {
    const friends = await hub.presenceAudience(userId);
    if (friends.length === 0) return [];
    const r = await app.db.query<{ id: string; last_seen_at: Date | null }>(
      'SELECT id, last_seen_at FROM users WHERE id = ANY($1::uuid[]) AND erased_at IS NULL',
      [friends],
    );
    return r.rows.map((row) => {
      const online = hub.isOnline(row.id);
      return { userId: row.id, online, lastSeenAt: online || !row.last_seen_at ? null : row.last_seen_at.toISOString() };
    });
  }

  let sessionTimer: NodeJS.Timeout | null = null;
  app.addHook('onReady', async () => {
    sessionTimer = setInterval(() => {
      closeRevokedSockets(app).catch((err: unknown) => app.log.warn({ err }, 'contrôle des sessions WebSocket en échec'));
    }, SESSION_CHECK_INTERVAL_MS);
    sessionTimer.unref();
  });
  app.addHook('onClose', async () => {
    if (sessionTimer) clearInterval(sessionTimer);
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
      const conn = hub.attach(socket, { userId: auth.userId, sessionId: auth.sessionId, locale: auth.locale });
      presenceSnapshot(auth.userId)
        .then((users) => {
          if (users.length > 0) hub.send(conn, { t: 'presence.update', users });
        })
        .catch((err: unknown) => app.log.warn({ err }, 'présence des amis illisible'));
    },
  );
};

export default realtimeRoutes;
