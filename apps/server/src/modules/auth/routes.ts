/**
 * Routes /v1/auth (détail des corps et réponses : @kwatt/protocol, http/auth.ts).
 * Limitation de débit : RATE_LIMIT_AUTH_PER_MIN (5) essais par minute et par adresse IP
 * sur les routes sensibles, plus des limites par compte dans le service.
 */
import {
  ForgotPasswordRequestSchema,
  GuestRequestSchema,
  LoginRequestSchema,
  PseudoAvailabilityQuerySchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  ResetPasswordRequestSchema,
  ResetVerifyRequestSchema,
  VerifyEmailRequestSchema,
  ChangePasswordRequestSchema,
} from '@kwatt/protocol';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { bearerToken, type AuthContext } from './context.js';
import { authFromToken, requireAuth } from './plugin.js';
import { AuthService } from './service.js';

const authRoutes: FastifyPluginAsync = async (app) => {
  const service = new AuthService(app);
  const strict = { rateLimit: { max: app.config.rateLimitAuthPerMin, timeWindow: '1 minute' } };
  const relaxed = { rateLimit: { max: Math.max(30, app.config.rateLimitAuthPerMin * 6), timeWindow: '1 minute' } };

  /** Jeton facultatif (inscription depuis un compte invité). Un jeton invalide est ignoré. */
  async function optionalAuth(req: FastifyRequest): Promise<AuthContext | null> {
    const token = bearerToken(req.headers.authorization);
    if (!token) return null;
    try {
      return await authFromToken(app, token);
    } catch (err) {
      if (err instanceof AppError) return null;
      throw err;
    }
  }

  app.post('/v1/auth/register', { config: strict }, async (req, reply) => {
    const body = parse(RegisterRequestSchema, req.body);
    const result = await service.register(body, await optionalAuth(req));
    return reply.status(201).send(result);
  });

  app.post('/v1/auth/login', { config: strict }, async (req) => {
    const body = parse(LoginRequestSchema, req.body);
    return service.login(body.login, body.password, body.device);
  });

  app.post('/v1/auth/guest', { config: strict }, async (req, reply) => {
    const body = parse(GuestRequestSchema, req.body);
    return reply.status(201).send(await service.guest(body.device, body.locale));
  });

  app.post('/v1/auth/refresh', { config: relaxed }, async (req) => {
    const body = parse(RefreshRequestSchema, req.body);
    return service.refresh(body.refreshToken, body.device);
  });

  app.post('/v1/auth/logout', { preHandler: app.authenticate }, async (req) => {
    await service.logout(requireAuth(req));
    return { ok: true };
  });

  app.post('/v1/auth/logout-all', { preHandler: app.authenticate }, async (req) => {
    await service.logoutAll(requireAuth(req));
    return { ok: true };
  });

  app.post('/v1/auth/email/verify', { preHandler: app.requireMember, config: strict }, async (req) => {
    const body = parse(VerifyEmailRequestSchema, req.body);
    return service.verifyEmail(requireAuth(req), body.code);
  });

  app.post('/v1/auth/email/resend', { preHandler: app.requireMember, config: strict }, async (req) => {
    return service.resendVerification(requireAuth(req));
  });

  app.post('/v1/auth/password/forgot', { config: strict }, async (req, reply) => {
    const body = parse(ForgotPasswordRequestSchema, req.body);
    await service.forgotPassword(body.email);
    return reply.status(202).send({ ok: true });
  });

  app.post('/v1/auth/password/reset/verify', { config: strict }, async (req) => {
    const body = parse(ResetVerifyRequestSchema, req.body);
    return service.verifyResetCode(body.email, body.code);
  });

  app.post('/v1/auth/password/reset', { config: strict }, async (req) => {
    const body = parse(ResetPasswordRequestSchema, req.body);
    return service.resetPassword(body.resetToken, body.newPassword, body.device);
  });

  app.post('/v1/auth/password/change', { preHandler: app.requireMember, config: strict }, async (req) => {
    const body = parse(ChangePasswordRequestSchema, req.body);
    await service.changePassword(requireAuth(req), body.currentPassword, body.newPassword);
    return { ok: true };
  });

  app.get('/v1/auth/pseudo/availability', { config: relaxed }, async (req) => {
    const query = parse(PseudoAvailabilityQuerySchema, req.query);
    return service.pseudoAvailability(query.pseudo);
  });
};

export default authRoutes;
