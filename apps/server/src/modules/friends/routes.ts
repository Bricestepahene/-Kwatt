/**
 * Routes /v1/friends (écran 12, /ami/[code] ; contrat C6) : voir @kwatt/protocol (http/friends.ts).
 * Profils seulement. Branche aussi la présence (amis) et la visibilité des profils jeunes.
 */
import {
  FriendCodeSchema,
  FriendRequestBodySchema,
  FriendSearchQuerySchema,
  type FriendCodeTarget,
  type FriendRequestResult,
  type FriendRequestsResponse,
  type FriendSearchResponse,
  type FriendsResponse,
  type MyFriendCode,
} from '@kwatt/protocol';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { registerProfileRelation } from '../profiles/visibility.js';
import { areFriends } from './relations.js';
import { FriendsService, friendsAudience } from './service.js';

const UserParamSchema = z.object({ userId: z.uuid() });

const friendsRoutes: FastifyPluginAsync = async (app) => {
  const friends = new FriendsService({
    db: app.db,
    clock: app.clock,
    media: app.media,
    hub: app.realtime,
    notifications: app.notifications,
    liveGames: () => app.games.live(),
  });
  app.realtime.setPresenceAudience(friendsAudience(app.db));
  registerProfileRelation('friends', (db, viewerId, targetId) => areFriends(db, viewerId, targetId));

  app.accounts.onErase('friends', async (tx, userId) => {
    await tx.query('DELETE FROM friendships WHERE user_a = $1 OR user_b = $1', [userId]);
    await tx.query('DELETE FROM friend_codes WHERE user_id = $1', [userId]);
  });

  const member = { preHandler: app.requireMember };
  const me = (req: FastifyRequest) => {
    const auth = requireAuth(req);
    return { userId: auth.userId, pseudo: auth.pseudo ?? '?' };
  };
  const other = (req: FastifyRequest) => parse(UserParamSchema, req.params).userId;

  app.get('/v1/friends', member, async (req): Promise<FriendsResponse> => friends.list(me(req).userId));

  app.get('/v1/friends/requests', member, async (req): Promise<FriendRequestsResponse> => friends.requests(me(req).userId));

  app.get('/v1/friends/search', member, async (req): Promise<FriendSearchResponse> => {
    const { q } = parse(FriendSearchQuerySchema, req.query);
    return { items: await friends.search(me(req).userId, q) };
  });

  app.get('/v1/friends/code', member, async (req): Promise<MyFriendCode> => ({ code: await friends.myCode(me(req).userId) }));

  app.get('/v1/friends/code/:code', member, async (req): Promise<FriendCodeTarget> => {
    const raw = (req.params as { code: string }).code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const code = FriendCodeSchema.safeParse(raw);
    if (!code.success) throw new AppError('friends.not_found', 404);
    return friends.byCode(me(req).userId, code.data);
  });

  app.post('/v1/friends/requests', member, async (req): Promise<FriendRequestResult> => {
    const body = parse(FriendRequestBodySchema, req.body);
    return friends.request(me(req), body);
  });

  app.post('/v1/friends/requests/:userId/accept', member, async (req): Promise<FriendRequestResult> => friends.accept(me(req), other(req)));

  app.post('/v1/friends/requests/:userId/decline', member, async (req) => {
    await friends.decline(me(req).userId, other(req));
    return { ok: true };
  });

  app.delete('/v1/friends/:userId', member, async (req) => {
    await friends.remove(me(req).userId, other(req));
    return { ok: true };
  });
};

export default friendsRoutes;
