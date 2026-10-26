/**
 * Routes /v1/leagues (écrans 27 à 35, 28b, 34b) et tâche planifiée des ligues.
 * Le détail des routes est dans @kwatt/protocol (http/leagues.ts).
 */
import {
  CreateLeagueRequestSchema,
  CreateTeamRequestSchema,
  SetLineupRequestSchema,
  LeagueCodeSchema,
  LeagueListQuerySchema,
  SetMatchBoardRequestSchema,
  SetMatchTimeRequestSchema,
  type LeagueDetail,
  type LeagueExclusionView,
  type LeagueListResponse,
  type LeagueMatchView,
} from '@kwatt/protocol';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { MINUTE } from '../../lib/clock.js';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { whenLeagueGames } from './games.js';
import { leagueIdByCode } from './model.js';
import {
  arrive,
  cancelLeague,
  closeRegistrations,
  createLeague,
  joinLeague,
  leaveLeague,
  recordGameResult,
  removeMember,
  resolveDueMatches,
  sendReminders,
  setMatchBoard,
  setMatchTime,
  startLeague,
  validateLeague,
  type Actor,
  type LeagueDeps,
} from './service.js';
import { applyDueLineups, createTeam, joinTeam, setLineup } from './teams.js';
import { exclusionView, leagueDetail, listLeagues, matchView } from './views.js';

const leaguesRoutes: FastifyPluginAsync = async (app) => {
  const deps: LeagueDeps = { db: app.db, clock: app.clock, notifications: app.notifications, media: app.media, log: app.log };
  const actor = (req: FastifyRequest): Actor => {
    const a = requireAuth(req);
    return { userId: a.userId, kind: a.kind, ageGroup: a.ageGroup };
  };
  const params = (req: FastifyRequest) => req.params as { id: string; matchId?: string; userId?: string; code?: string; teamId?: string };
  const detail = (req: FastifyRequest, id: string): Promise<LeagueDetail> => leagueDetail(app.db, app.media, actor(req), id, app.clock.now());
  const write = { preHandler: app.authenticate, config: { rateLimit: { max: Math.max(30, app.config.rateLimitAuthPerMin * 6), timeWindow: '1 minute' } } };

  app.get('/v1/leagues', { preHandler: app.authenticate }, async (req): Promise<LeagueListResponse> => {
    const query = parse(LeagueListQuerySchema, req.query);
    return { items: await listLeagues(app.db, requireAuth(req).userId, query) };
  });

  app.post('/v1/leagues', { preHandler: app.requireMember, config: write.config }, async (req, reply): Promise<LeagueDetail> => {
    const body = parse(CreateLeagueRequestSchema, req.body);
    const id = await createLeague(deps, actor(req), body);
    reply.code(201);
    return detail(req, id);
  });

  app.get('/v1/leagues/by-code/:code', { preHandler: app.authenticate }, async (req): Promise<LeagueDetail> => {
    const code = parse(LeagueCodeSchema, (params(req).code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    return detail(req, await leagueIdByCode(app.db, code));
  });

  app.get('/v1/leagues/:id', { preHandler: app.authenticate }, async (req): Promise<LeagueDetail> => detail(req, params(req).id));

  app.post('/v1/leagues/:id/join', write, async (req): Promise<LeagueDetail> => {
    await joinLeague(deps, actor(req), params(req).id);
    return detail(req, params(req).id);
  });

  app.post('/v1/leagues/:id/leave', write, async (req): Promise<LeagueDetail> => {
    await leaveLeague(deps, actor(req), params(req).id);
    return detail(req, params(req).id);
  });

  app.delete('/v1/leagues/:id/members/:userId', { preHandler: app.requireMember, config: write.config }, async (req): Promise<LeagueDetail> => {
    await removeMember(deps, actor(req), params(req).id, params(req).userId ?? '');
    return detail(req, params(req).id);
  });

  app.post('/v1/leagues/:id/start', { preHandler: app.requireMember, config: write.config }, async (req): Promise<LeagueDetail> => {
    await startLeague(deps, actor(req), params(req).id);
    return detail(req, params(req).id);
  });

  app.post('/v1/leagues/:id/validate', { preHandler: app.requireMember, config: write.config }, async (req): Promise<LeagueDetail> => {
    await validateLeague(deps, actor(req), params(req).id);
    return detail(req, params(req).id);
  });

  app.post('/v1/leagues/:id/cancel', { preHandler: app.requireMember, config: write.config }, async (req): Promise<LeagueDetail> => {
    await cancelLeague(deps, actor(req), params(req).id);
    return detail(req, params(req).id);
  });

  // Ligues par équipes.
  app.post('/v1/leagues/:id/teams', write, async (req, reply): Promise<LeagueDetail> => {
    const { name } = parse(CreateTeamRequestSchema, req.body);
    await createTeam(deps, actor(req), params(req).id, name);
    reply.code(201);
    return detail(req, params(req).id);
  });

  app.post('/v1/leagues/:id/teams/:teamId/join', write, async (req): Promise<LeagueDetail> => {
    await joinTeam(deps, actor(req), params(req).id, params(req).teamId ?? '');
    return detail(req, params(req).id);
  });

  app.post('/v1/leagues/:id/team-matches/:matchId/lineup', write, async (req): Promise<LeagueDetail> => {
    const { order } = parse(SetLineupRequestSchema, req.body);
    await setLineup(deps, actor(req), params(req).id, params(req).matchId ?? '', order);
    return detail(req, params(req).id);
  });

  const match = (req: FastifyRequest): Promise<LeagueMatchView> => matchView(app.db, app.media, actor(req), params(req).id, params(req).matchId ?? '', app.clock.now());

  app.get('/v1/leagues/:id/matches/:matchId', { preHandler: app.authenticate }, match);

  app.post('/v1/leagues/:id/matches/:matchId/time', write, async (req): Promise<LeagueMatchView> => {
    const { time } = parse(SetMatchTimeRequestSchema, req.body);
    await setMatchTime(deps, actor(req), params(req).id, params(req).matchId ?? '', time);
    return match(req);
  });

  app.post('/v1/leagues/:id/matches/:matchId/board', write, async (req): Promise<LeagueMatchView> => {
    const { board } = parse(SetMatchBoardRequestSchema, req.body);
    await setMatchBoard(deps, actor(req), params(req).id, params(req).matchId ?? '', board);
    return match(req);
  });

  app.post('/v1/leagues/:id/matches/:matchId/arrive', write, async (req): Promise<LeagueMatchView> => {
    await arrive(deps, actor(req), params(req).id, params(req).matchId ?? '');
    return match(req);
  });

  app.get('/v1/leagues/:id/exclusions/:userId', { preHandler: app.authenticate }, async (req): Promise<LeagueExclusionView> =>
    exclusionView(app.db, app.media, actor(req), params(req).id, params(req).userId ?? ''),
  );

  // Fin d'une partie de ligue (service des parties en ligne, contrat C3).
  whenLeagueGames((games) =>
    games.onGameFinished(async (event) => {
      if (event.context === 'league') await recordGameResult(deps, event);
    }),
  );

  // Toutes les minutes : clôture des inscriptions, validation manquée, ordres des équipes, rappels, présences et forfaits.
  app.registerJob('leagues.tick', MINUTE, async ({ now }) => {
    await closeRegistrations(deps, now);
    await applyDueLineups(deps, now);
    await sendReminders(deps, now);
    await resolveDueMatches(deps, now);
  });

  app.accounts.addExportSection('leagues', async (db, userId) => {
    const r = await db.query(
      `SELECT l.name, l.game, l.access, l.format, l.status, m.status AS "memberStatus", m.joined_at AS "joinedAt", m.entry_paid AS "entry", m.fines_paid AS "fines"
         FROM league_members m JOIN leagues l ON l.id = m.league_id WHERE m.user_id = $1 ORDER BY m.joined_at`,
      [userId],
    );
    const medals = await db.query('SELECT kind, title, awarded_at AS "awardedAt" FROM medals WHERE user_id = $1 ORDER BY awarded_at', [userId]);
    return { memberships: r.rows, medals: medals.rows };
  });
};

export default leaguesRoutes;
