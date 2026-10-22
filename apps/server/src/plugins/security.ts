/**
 * Sécurité HTTP : en-têtes (helmet), CORS restreint, limitation de débit, format d'erreur.
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { AppError, toAppError } from '../lib/errors.js';

export const securityPlugin = fp(
  async (app) => {
    const { config } = app;

    await app.register(helmet, {
      // API JSON : rien à charger. La page de partage pose sa propre politique.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"], 'base-uri': ["'none'"] },
      },
      // Les photos (/media) s'affichent aussi dans la version web de l'appli.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: config.env === 'production' ? { maxAge: 31_536_000, includeSubDomains: false } : false,
    });

    // L'appli mobile n'a pas besoin de CORS ; seule la version web (vérification) en a besoin.
    const devOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    await app.register(cors, {
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : config.env === 'production' ? false : devOrigin,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['authorization', 'content-type'],
      maxAge: 600,
    });

    await app.register(rateLimit, {
      global: true,
      max: config.rateLimitGlobalPerMin,
      timeWindow: '1 minute',
      allowList: (req) => req.url.startsWith('/media/'),
      errorResponseBuilder: (_req, ctx) =>
        new AppError('common.rate_limited', 429, { retryAfterSeconds: Math.max(1, Math.ceil(ctx.ttl / 1000)) }),
    });

    app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
      const appErr = toAppError(err);
      if (appErr.status >= 500) req.log.error({ err }, 'erreur interne');
      else if (!(err instanceof AppError)) req.log.debug({ err }, 'requête refusée');
      return reply.status(appErr.status).send(appErr.toBody());
    });

    app.setNotFoundHandler((_req, reply) => reply.status(404).send(new AppError('common.not_found', 404).toBody()));
  },
  { name: 'kwatt-security' },
);
