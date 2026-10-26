/**
 * Routes /v1/games et messages temps réel `game.*` (contrat C3), branchement des ligues
 * (`setLeagueGames`), présence des joueurs, minuterie des parties et reprise au démarrage.
 *
 *   POST /v1/games/machine           partie contre la machine sur le serveur (pari possible)
 *   GET  /v1/games/live?family=      parties publiques en cours (/regarder, accueil)
 *   GET  /v1/games/mine              mes parties en cours (« Reprendre une partie »)
 *   GET  /v1/games/:id               résumé et rejeu
 *   GET  /v1/games/:id/dice          preuve du dé (écran 22)
 *   GET  /v1/games/:id/watch         vue du spectateur (écran 37)
 *   GET  /v1/games/:id/predictions   pronostics ; POST { seat } pour pronostiquer
 */
import {
  CreateMachineGameRequestSchema,
  GameDrawAnswerMessageSchema,
  GameDrawOfferMessageSchema,
  GameMoveMessageSchema,
  GameReactMessageSchema,
  GameResignMessageSchema,
  GameRollMessageSchema,
  GameSubscribeMessageSchema,
  GameSyncMessageSchema,
  GameUnsubscribeMessageSchema,
  LiveGamesQuerySchema,
  PredictionRequestSchema,
  type CreateMachineGameResponse,
  type DiceProof,
  type GameSummary,
  type LiveGamesResponse,
  type MyGamesResponse,
  type PredictionsView,
  type WatchView,
} from '@kwatt/protocol';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import type { AuthContext } from '../auth/context.js';
import { requireAuth } from '../auth/plugin.js';
import { leagueGames, setLeagueGames, type LeagueGamesPort } from '../leagues/games.js';
import { gameTopic } from './actor.js';
import { placePrediction, predictionsView, reactionKey, recordSpectatorReaction, spectatorReactions } from './spectators.js';
import { diceProof, gameSummary, liveGameOf } from './views.js';

/** Peut miser ou pronostiquer : profil de 18 ans et plus à l'adresse vérifiée. */
export function canBet(auth: Pick<AuthContext, 'kind' | 'ageGroup' | 'verified'>): boolean {
  return auth.kind === 'member' && auth.ageGroup === 'adult' && auth.verified;
}

/** Réactions gardées au plus, par spectateur et par partie. */
const MAX_SPECTATOR_REACTIONS = 30;

const gamesRoutes: FastifyPluginAsync = async (app) => {
  const games = app.games;
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;

  app.post('/v1/games/machine', { preHandler: app.requireMember }, async (req, reply): Promise<CreateMachineGameResponse> => {
    const auth = requireAuth(req);
    const body = parse(CreateMachineGameRequestSchema, req.body);
    const res = await games.createMachineGame({ userId: auth.userId, pseudo: auth.pseudo ?? '?', canBet: canBet(auth) }, body);
    reply.code(201);
    return res;
  });

  app.get('/v1/games/live', { preHandler: app.authenticate }, async (req): Promise<LiveGamesResponse> => {
    const { family } = parse(LiveGamesQuerySchema, req.query);
    const viewer = requireAuth(req).userId;
    const actors = games
      .live()
      .filter((a) => a.config.listed && a.config.context !== 'machine' && (!family || a.config.family === family))
      .sort((a, b) => b.spectatorCount() - a.spectatorCount() || b.config.startedAt.getTime() - a.config.startedAt.getTime())
      .slice(0, 30);
    return { items: await Promise.all(actors.map((a) => liveGameOf(app.db, app.media, a, viewer))) };
  });

  app.get('/v1/games/mine', { preHandler: app.authenticate }, async (req): Promise<MyGamesResponse> => {
    const me = requireAuth(req).userId;
    const r = await app.db.query<{ id: string }>(
      `SELECT g.id FROM games g JOIN game_players p ON p.game_id = g.id
        WHERE p.user_id = $1 AND g.status = 'playing' AND p.out_at IS NULL ORDER BY g.started_at DESC LIMIT 10`,
      [me],
    );
    const items = [];
    for (const row of r.rows) {
      const actor = await games.get(row.id);
      if (!actor || actor.status !== 'playing') continue;
      const mySeat = actor.seatsOf(me)[0] ?? 0;
      const turn = actor.rules.turnSeat();
      items.push({ ...(await liveGameOf(app.db, app.media, actor, me)), mySeat, myTurn: turn !== null && actor.seatsOf(me).includes(turn) });
    }
    return { items };
  });

  app.get('/v1/games/:id', { preHandler: app.authenticate }, async (req): Promise<GameSummary> => gameSummary(app.db, app.media, id(req), requireAuth(req).userId));

  app.get('/v1/games/:id/dice', { preHandler: app.authenticate }, async (req): Promise<DiceProof> => diceProof(app.db, id(req)));

  app.get('/v1/games/:id/predictions', { preHandler: app.authenticate }, async (req): Promise<PredictionsView> => {
    const auth = requireAuth(req);
    const actor = await games.require(id(req));
    return predictionsView(app.db, actor, { userId: auth.userId, canBet: canBet(auth) });
  });

  app.post('/v1/games/:id/predictions', { preHandler: app.requireMember }, async (req): Promise<PredictionsView> => {
    const auth = requireAuth(req);
    const { seat } = parse(PredictionRequestSchema, req.body);
    const actor = await games.require(id(req));
    const viewer = { userId: auth.userId, canBet: canBet(auth) };
    await placePrediction(app.db, actor, viewer, seat);
    return predictionsView(app.db, actor, viewer);
  });

  app.get('/v1/games/:id/watch', { preHandler: app.authenticate }, async (req): Promise<WatchView> => {
    const auth = requireAuth(req);
    const actor = await games.require(id(req));
    const game = await gameSummary(app.db, app.media, actor.id, auth.userId);
    let queue: WatchView['queue'] = null;
    if (actor.config.rules.room) {
      const q = await app.db.query<{ user_id: string; queue_pos: number }>(
        `SELECT user_id, queue_pos FROM room_members WHERE room_id = $1 AND role = 'queue' AND left_at IS NULL ORDER BY queue_pos`,
        [actor.config.rules.room.roomId],
      );
      const mine = q.rows.findIndex((x) => x.user_id === auth.userId);
      queue = { length: q.rows.length, myPosition: mine >= 0 ? mine + 1 : null, code: actor.config.rules.room.code };
    }
    return {
      game,
      spectators: actor.spectatorCount(),
      predictions: await predictionsView(app.db, actor, { userId: auth.userId, canBet: canBet(auth) }),
      // Les joueurs ne voient les réactions des spectateurs qu'à la fin.
      reactions: actor.isPlayer(auth.userId) && actor.status === 'playing' ? [] : await spectatorReactions(app.db, actor.id),
      queue,
    };
  });

  // --- Temps réel -------------------------------------------------------------

  app.registerWsHandler('game.subscribe', GameSubscribeMessageSchema, async ({ msg, conn, userId, reply }) => {
    const actor = await games.require(msg.gameId);
    app.realtime.subscribe(conn, gameTopic(actor.id));
    reply(actor.stateFor(userId));
  });

  app.registerWsHandler('game.unsubscribe', GameUnsubscribeMessageSchema, ({ msg, conn }) => {
    app.realtime.unsubscribe(conn, gameTopic(msg.gameId));
  });

  app.registerWsHandler('game.sync', GameSyncMessageSchema, async ({ msg, userId, reply }) => {
    const actor = await games.require(msg.gameId);
    reply(actor.stateFor(userId));
  });

  app.registerWsHandler('game.move', GameMoveMessageSchema, async ({ msg, userId, reply }) => {
    const actor = await games.require(msg.gameId);
    await actor.move(userId, msg.seq, msg.move);
    reply({ t: 'game.ack', gameId: actor.id, seq: actor.seq });
  });

  app.registerWsHandler('game.roll', GameRollMessageSchema, async ({ msg, userId, reply }) => {
    const actor = await games.require(msg.gameId);
    await actor.roll(userId, msg.seq, msg.clientSeed);
    reply({ t: 'game.ack', gameId: actor.id, seq: actor.seq });
  });

  app.registerWsHandler('game.resign', GameResignMessageSchema, async ({ msg, userId, reply }) => {
    const actor = await games.require(msg.gameId);
    await actor.resign(userId);
    reply({ t: 'game.ack', gameId: actor.id, seq: actor.seq });
  });

  app.registerWsHandler('game.draw.offer', GameDrawOfferMessageSchema, async ({ msg, userId, reply }) => {
    const actor = await games.require(msg.gameId);
    await actor.offerDraw(userId);
    reply({ t: 'game.ack', gameId: actor.id, seq: actor.seq });
  });

  app.registerWsHandler('game.draw.answer', GameDrawAnswerMessageSchema, async ({ msg, userId, reply }) => {
    const actor = await games.require(msg.gameId);
    await actor.answerDraw(userId, msg.accept);
    reply({ t: 'game.ack', gameId: actor.id, seq: actor.seq });
  });

  app.registerWsHandler('game.react', GameReactMessageSchema, async ({ msg, userId }) => {
    const actor = await games.require(msg.gameId);
    const key = reactionKey(msg.key);
    if (!key) throw new AppError('game.reaction_unknown', 400);
    if (actor.isPlayer(userId)) {
      actor.react(userId, `reaction.${key}`);
      return;
    }
    const n = await app.db.query<{ n: number }>('SELECT count(*)::int AS n FROM game_reactions WHERE game_id = $1 AND user_id = $2', [actor.id, userId]);
    if ((n.rows[0]?.n ?? 0) >= MAX_SPECTATOR_REACTIONS) return;
    await recordSpectatorReaction(app.db, actor.id, userId, key);
  });

  // Présence : coupure et retour des joueurs assis.
  app.realtime.onPresenceChange((userId, online) => games.presence(userId, online));

  // --- Ligues (contrat C3) ----------------------------------------------------

  const port: LeagueGamesPort = {
    async createGame(tx, input) {
      const ids = input.seats.map((s) => s.userId);
      const names = await tx.query<{ id: string; pseudo: string; kind: string }>(
        `SELECT u.id, COALESCE(p.pseudo::text, u.display_name, '?') AS pseudo, u.kind::text AS kind
           FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ANY($1::uuid[])`,
        [ids],
      );
      const byId = new Map(names.rows.map((x) => [x.id, x]));
      const cfg = await games.createGame(tx, {
        context: 'league',
        variant: input.variant,
        seats: input.seats.map((s) => ({ userId: s.userId, name: byId.get(s.userId)?.pseudo ?? '?', staking: false, guest: byId.get(s.userId)?.kind === 'guest' })),
        ranked: input.rated,
        stake: 0,
        clock: input.clock,
        turnMs: input.clock ? null : 30_000,
        league: input.league,
        ...(input.startAt ? { startAt: input.startAt } : {}),
      });
      return { gameId: cfg.id };
    },
    onGameFinished(listener) {
      games.onGameFinished((event) => listener(event));
    },
  };
  // Un test peut avoir branché une fausse table avant de construire le serveur : on la garde.
  if (!leagueGames()) setLeagueGames(port);

  // --- Minuterie et reprise --------------------------------------------------

  let timer: NodeJS.Timeout | null = null;
  app.addHook('onReady', async () => {
    const resumed = await games.resumeAll();
    if (resumed > 0) app.log.info({ resumed }, 'parties en ligne reprises');
    if (app.config.jobsEnabled) {
      timer = setInterval(() => void games.tick(), 1_000);
      timer.unref();
    }
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    await games.settled().catch(() => undefined);
    games.close();
    if (leagueGames() === port) setLeagueGames(null);
  });
};

export default gamesRoutes;
