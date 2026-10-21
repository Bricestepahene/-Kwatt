/**
 * Décorateurs d'authentification (SPEC §9), à utiliser en preHandler :
 *
 *   app.get('/v1/rooms', { preHandler: app.authenticate }, …)      invité ou profil
 *   app.post('/v1/rooms', { preHandler: app.requireMember }, …)    profil seulement
 *   app.post('/v1/stakes', { preHandler: [app.requireAdult, app.requireVerified] }, …)
 *
 * Dans le gestionnaire : `const auth = requireAuth(req)`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../../lib/errors.js';
import { bearerToken, loadAuthContext, type AuthContext } from './context.js';

/** Contexte d'authentification d'une requête passée par un décorateur (sinon auth.required). */
export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new AppError('auth.required', 401);
  return req.auth;
}

/** Contexte d'authentification à partir d'un jeton d'accès brut (WebSocket : ?token=). */
export function authFromToken(app: FastifyInstance, token: string): Promise<AuthContext> {
  return loadAuthContext(app.db, app.tokens, app.clock, token);
}

export const authPlugin = fp(
  async (app) => {
    app.decorateRequest('auth', null);

    const authenticate = async (req: FastifyRequest): Promise<AuthContext> => {
      if (req.auth) return req.auth;
      const token = bearerToken(req.headers.authorization);
      if (!token) throw new AppError('auth.required', 401);
      req.auth = await authFromToken(app, token);
      return req.auth;
    };

    const member = async (req: FastifyRequest): Promise<AuthContext> => {
      const auth = await authenticate(req);
      if (auth.kind !== 'member') throw new AppError('auth.member_required', 403);
      return auth;
    };

    app.decorate('authenticate', async (req: FastifyRequest) => {
      await authenticate(req);
    });
    app.decorate('requireMember', async (req: FastifyRequest) => {
      await member(req);
    });
    app.decorate('requireAdult', async (req: FastifyRequest) => {
      const auth = await member(req);
      if (auth.ageGroup !== 'adult') throw new AppError('auth.adult_required', 403);
    });
    app.decorate('requireVerified', async (req: FastifyRequest) => {
      const auth = await member(req);
      if (!auth.verified) throw new AppError('auth.verification_required', 403);
    });
  },
  { name: 'kwatt-auth' },
);
