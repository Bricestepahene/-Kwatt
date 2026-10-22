/**
 * GET /v1/health : état du serveur et de la base (sondes Docker et Caddy).
 */
import type { HealthResponse } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { SERVER_VERSION } from '../../version.js';

const healthRoutes: FastifyPluginAsync = async (app) => {
  const startedAt = Date.now();
  app.get('/v1/health', { config: { rateLimit: false } }, async (_req, reply) => {
    let db: HealthResponse['db'] = 'ok';
    try {
      await app.db.query('SELECT 1');
    } catch {
      db = 'down';
    }
    const body: HealthResponse = {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      version: SERVER_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      time: app.clock.now().toISOString(),
    };
    return reply.status(db === 'ok' ? 200 : 503).send(body);
  });
};

export default healthRoutes;
