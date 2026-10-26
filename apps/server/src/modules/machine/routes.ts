/**
 * Routes /v1/machine (contrat C2, profils seulement) :
 *   GET  /v1/machine/offers?family=dames|ludo&variant=…&machines=1..3
 *   POST /v1/machine/results   (partie hors connexion, idempotente par clientGameId)
 *
 * Les parties en ligne avec pari se règlent par `settleMachineOnline` (service.ts), appelée
 * par le module des parties en ligne dans sa transaction de fin de partie.
 */
import { MachineOffersQuerySchema, MachineResultRequestSchema, type MachineOffersResponse, type MachineResultResponse } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { machineOffers, submitMachineResult } from './service.js';

const machineRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/machine/offers', { preHandler: app.requireMember }, async (req): Promise<MachineOffersResponse> => {
    const query = parse(MachineOffersQuerySchema, req.query);
    const auth = requireAuth(req);
    const canBet = auth.ageGroup === 'adult' && auth.verified;
    return machineOffers(app.db, { userId: auth.userId, canBet }, query, app.clock.now());
  });

  // Rejouer une partie coûte du calcul (moteur de dames) : 30 envois par minute au plus.
  app.post(
    '/v1/machine/results',
    { preHandler: app.requireMember, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req): Promise<MachineResultResponse> => {
      const body = parse(MachineResultRequestSchema, req.body);
      return submitMachineResult(app.db, requireAuth(req).userId, body, app.clock.now());
    },
  );

  app.accounts.addExportSection('machine', async (db, userId) => {
    const r = await db.query(
      `SELECT family, variant, difficulty, mode, outcome, bet, day, played_at AS "playedAt", response
         FROM machine_results WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return r.rows;
  });

  app.accounts.onErase('machine', async (tx, userId) => {
    await tx.query('DELETE FROM machine_results WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM machine_progress WHERE user_id = $1', [userId]);
  });
};

export default machineRoutes;
