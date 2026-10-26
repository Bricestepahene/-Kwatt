/**
 * Service HTTP de la machine du Ludo (interne : seul le serveur Kwatt l'appelle).
 *
 *   GET  /health     → { ok, service, version, levels: { facile: 'facile@1', … } }
 *   POST /v1/choose  → { move, candidates, stats, agent, level }
 *
 * Il reçoit la position (lancer déjà fait par le serveur) ; il ne voit jamais
 * le dé. Erreurs : `{ error: { code, params } }`, comme l'API.
 * Délai : le budget de réflexion est plafonné (`maxBudgetMs`), et la requête
 * entière aussi (`requestTimeoutMs`).
 */
import { chooseMove, LEVEL_SPECS, LEVELS, NoMoveError } from '@kwatt/ludo-ai';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { checkedState, ChooseRequestSchema, InvalidStateError } from './schema.js';

export const SERVICE_VERSION = '1.0.0';

export interface ServiceOptions {
  /** Plafond du budget de réflexion par coup (ms). */
  maxBudgetMs?: number;
  /** Délai maximal d'une requête (ms). */
  requestTimeoutMs?: number;
  logger?: FastifyServerOptions['logger'];
  /** Horloge injectable (tests). */
  now?: () => number;
}

export function errorBody(code: string, params: Record<string, unknown> = {}): { error: { code: string; params: Record<string, unknown> } } {
  return { error: { code, params } };
}

export function buildService(options: ServiceOptions = {}): FastifyInstance {
  const maxBudgetMs = options.maxBudgetMs ?? 2000;
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 64 * 1024,
    requestTimeout: options.requestTimeoutMs ?? 10_000,
  });

  app.setErrorHandler((err: { statusCode?: number; code?: string }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) app.log.error({ err }, 'erreur du moteur');
    void reply.status(status).send(errorBody(status === 500 ? 'ludo_ai.internal' : 'ludo_ai.invalid_request', err.code ? { reason: err.code } : {}));
  });
  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send(errorBody('ludo_ai.not_found'));
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'ludo-ai',
    version: SERVICE_VERSION,
    levels: Object.fromEntries(LEVELS.map((l) => [l, LEVEL_SPECS[l].agent.id])),
    maxBudgetMs,
  }));

  app.post('/v1/choose', async (req, reply) => {
    const parsed = ChooseRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(errorBody('ludo_ai.invalid_request', { issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) }));
    }
    const body = parsed.data;
    let state;
    try {
      state = checkedState(body.state);
    } catch (e) {
      if (e instanceof InvalidStateError) return reply.status(400).send(errorBody(e.code, e.params));
      throw e;
    }
    if (state.phase !== 'move') return reply.status(409).send(errorBody('ludo_ai.not_move_phase', { phase: state.phase }));
    const budgetMs = Math.min(maxBudgetMs, body.budgetMs ?? LEVEL_SPECS[body.level].budgetMs);
    try {
      const result = chooseMove({
        state,
        level: body.level,
        budgetMs,
        ...(body.legal ? { legal: body.legal } : {}),
        ...(body.seed !== undefined ? { seed: body.seed } : {}),
        ...(options.now ? { now: options.now } : {}),
      });
      req.log.info({ level: body.level, agent: result.agent, elapsedMs: Math.round(result.stats.elapsedMs) }, 'coup choisi');
      return result;
    } catch (e) {
      if (e instanceof NoMoveError) return reply.status(409).send(errorBody('ludo_ai.no_move'));
      throw e;
    }
  });

  return app;
}
