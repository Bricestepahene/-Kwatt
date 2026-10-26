/**
 * Routes /v1/challenges (écran 26, /defi/nouveau, /defi/[id]) : voir le contrat dans
 * @kwatt/protocol (http/challenges.ts). Profils seulement.
 */
import {
  ChallengeCounterRequestSchema,
  CreateChallengeRequestSchema,
  StakeCapQuerySchema,
  type ChallengeListResponse,
  type ChallengeView,
  type StakeCapView,
} from '@kwatt/protocol';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { MINUTE } from '../../lib/clock.js';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { ChallengesService, type ChallengeActor } from './service.js';

const challengesRoutes: FastifyPluginAsync = async (app) => {
  const challenges = new ChallengesService({ db: app.db, clock: app.clock, media: app.media, notifications: app.notifications, rooms: app.rooms });
  const member = { preHandler: app.requireMember };
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;
  const actor = (req: FastifyRequest): ChallengeActor => {
    const auth = requireAuth(req);
    return { userId: auth.userId, kind: auth.kind, pseudo: auth.pseudo };
  };

  app.get('/v1/challenges/cap', member, async (req): Promise<StakeCapView> => {
    const q = parse(StakeCapQuerySchema, req.query);
    return challenges.cap(requireAuth(req).userId, q.userId, q.variant);
  });

  app.get('/v1/challenges', member, async (req): Promise<ChallengeListResponse> => ({ items: await challenges.list(requireAuth(req).userId) }));

  app.post('/v1/challenges', member, async (req, reply): Promise<ChallengeView> => {
    const created = await challenges.create(actor(req), parse(CreateChallengeRequestSchema, req.body));
    reply.code(201);
    return challenges.view(created, requireAuth(req).userId);
  });

  app.get('/v1/challenges/:id', member, async (req): Promise<ChallengeView> => challenges.view(id(req), requireAuth(req).userId));

  app.post('/v1/challenges/:id/accept', member, async (req): Promise<ChallengeView> => {
    await challenges.accept(actor(req), id(req));
    return challenges.view(id(req), requireAuth(req).userId);
  });

  app.post('/v1/challenges/:id/counter', member, async (req): Promise<ChallengeView> => {
    await challenges.counter(actor(req), id(req), parse(ChallengeCounterRequestSchema, req.body).stake);
    return challenges.view(id(req), requireAuth(req).userId);
  });

  app.post('/v1/challenges/:id/decline', member, async (req): Promise<ChallengeView> => {
    await challenges.decline(actor(req), id(req));
    return challenges.view(id(req), requireAuth(req).userId);
  });

  app.post('/v1/challenges/:id/cancel', member, async (req): Promise<ChallengeView> => {
    await challenges.cancel(actor(req), id(req));
    return challenges.view(id(req), requireAuth(req).userId);
  });

  // Défis sans réponse depuis 2 h.
  app.registerJob('challenges.expire', MINUTE, async ({ now }) => {
    await challenges.expire(now);
  });
};

export default challengesRoutes;
