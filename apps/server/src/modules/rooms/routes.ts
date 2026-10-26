/**
 * Routes /v1/rooms et messages temps réel `room.*` (écrans 02, 24 et 25, SPEC §10).
 *
 *   GET  /v1/rooms/by-code/:code   aperçu (sans jeton possible : écran 02)
 *   GET  /v1/rooms/open?game=      salons ouverts et publics
 *   POST /v1/rooms                 créer (profil) → RoomView
 *   GET  /v1/rooms/:code           vue complète
 *   POST /v1/rooms/:code/join | leave | ready | start | invite
 *   WS   room.subscribe / room.unsubscribe → room.state
 */
import {
  CreateRoomRequestSchema,
  JoinRoomRequestSchema,
  OpenRoomsQuerySchema,
  RoomInviteRequestSchema,
  RoomReadyRequestSchema,
  RoomSubscribeMessageSchema,
  RoomUnsubscribeMessageSchema,
  type OpenRoomsResponse,
  type RoomPreview,
  type RoomView,
} from '@kwatt/protocol';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { SECOND } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { openRooms, roomByCode, roomPreview, roomTopic, roomView, type RoomActor } from './service.js';

/** « abc-def » → « ABCDEF » ; code mal formé : salon introuvable. */
export function normalizeRoomCode(raw: string): string {
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new AppError('room.not_found', 404);
  return code;
}

const roomsRoutes: FastifyPluginAsync = async (app) => {
  const rooms = app.rooms;
  const viewDeps = { db: app.db, hub: app.realtime, media: app.media, clock: app.clock };

  const code = (req: FastifyRequest) => normalizeRoomCode((req.params as { code: string }).code);
  const actor = (req: FastifyRequest): RoomActor => {
    const auth = requireAuth(req);
    return { userId: auth.userId, kind: auth.kind, pseudo: auth.pseudo };
  };
  const view = (req: FastifyRequest, c: string): Promise<RoomView> => roomView(viewDeps, c, requireAuth(req).userId);

  app.get('/v1/rooms/by-code/:code', async (req): Promise<RoomPreview> => {
    const preview = await roomPreview(app.db, code(req));
    if (preview.status === 'closed') throw new AppError('room.closed', 410);
    return preview;
  });

  app.get('/v1/rooms/open', { preHandler: app.authenticate }, async (req): Promise<OpenRoomsResponse> => {
    const { game } = parse(OpenRoomsQuerySchema, req.query);
    return { items: await openRooms(app.db, game) };
  });

  app.post('/v1/rooms', { preHandler: app.requireMember }, async (req, reply): Promise<RoomView> => {
    const body = parse(CreateRoomRequestSchema, req.body);
    const c = await rooms.create(actor(req), body);
    reply.code(201);
    return view(req, c);
  });

  app.get('/v1/rooms/:code', { preHandler: app.authenticate }, async (req): Promise<RoomView> => {
    const c = code(req);
    await roomByCode(app.db, c);
    return view(req, c);
  });

  app.post('/v1/rooms/:code/join', { preHandler: app.authenticate }, async (req): Promise<RoomView> => {
    const c = code(req);
    await rooms.join(actor(req), c, parse(JoinRoomRequestSchema, req.body ?? {}));
    return view(req, c);
  });

  app.post('/v1/rooms/:code/leave', { preHandler: app.authenticate }, async (req): Promise<RoomView> => {
    const c = code(req);
    await rooms.leave(actor(req), c);
    return view(req, c);
  });

  app.post('/v1/rooms/:code/ready', { preHandler: app.authenticate }, async (req): Promise<RoomView> => {
    const c = code(req);
    await rooms.setReady(actor(req), c, parse(RoomReadyRequestSchema, req.body).ready);
    return view(req, c);
  });

  app.post('/v1/rooms/:code/start', { preHandler: app.authenticate }, async (req): Promise<RoomView> => {
    const c = code(req);
    await rooms.start(actor(req), c);
    return view(req, c);
  });

  app.post('/v1/rooms/:code/invite', { preHandler: app.requireMember }, async (req): Promise<{ ok: true }> => {
    await rooms.invite(actor(req), code(req), parse(RoomInviteRequestSchema, req.body).userId);
    return { ok: true };
  });

  // --- Temps réel -------------------------------------------------------------

  app.registerWsHandler('room.subscribe', RoomSubscribeMessageSchema, async ({ msg, conn, userId, reply }) => {
    await roomByCode(app.db, msg.code);
    app.realtime.subscribe(conn, roomTopic(msg.code));
    reply({ t: 'room.state', room: await roomView(viewDeps, msg.code, userId) });
  });

  app.registerWsHandler('room.unsubscribe', RoomUnsubscribeMessageSchema, ({ msg, conn }) => {
    app.realtime.unsubscribe(conn, roomTopic(msg.code));
  });

  app.realtime.onPresenceChange((userId, online) => rooms.presence(userId, online));

  // Fin d'une partie du salon : formats, roi de la table, file.
  app.games.onGameFinished((event) => rooms.onGameFinished(event));

  // Places gardées expirées et salons inactifs.
  app.registerJob('rooms.tick', 5 * SECOND, async () => {
    await rooms.tick();
  });
};

export default roomsRoutes;
