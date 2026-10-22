import { WS_CLOSE_CODES, clientMessage } from '@kwatt/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { revokeAllSessions } from '../modules/admin/service.js';
import { TestWsClient, buildTestApp, connectWs, createGuest, createMember, type TestApp } from '../test/helpers.js';
import { WsConnectError } from '../test/ws-client.js';
import { closeRevokedSockets } from './routes.js';

const EchoSchema = clientMessage('test.echo', { text: z.string().max(20) });
const SlowSchema = clientMessage('test.slow', { n: z.number().int(), delayMs: z.number().int() });

let t: TestApp;
const open: TestWsClient[] = [];

beforeAll(async () => {
  t = await buildTestApp({
    suite: 'realtime',
    listen: true,
    extend: (app) => {
      app.registerWsHandler('test.echo', EchoSchema, ({ msg, reply, userId }) => {
        reply({ t: 'test.echoed', text: msg.text, userId });
      });
      app.registerWsHandler('test.slow', SlowSchema, async ({ msg, reply }) => {
        await new Promise((r) => setTimeout(r, msg.delayMs));
        reply({ t: 'test.done', n: msg.n });
      });
      app.registerWsHandler('test.fail', clientMessage('test.fail', {}), () => {
        throw new AppError('common.forbidden', 403, { why: 'test' });
      });
      app.registerWsHandler('test.crash', clientMessage('test.crash', {}), () => {
        throw new Error('panne');
      });
    },
  });
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
  t.app.realtime.setPresenceAudience(null);
});
afterAll(async () => {
  await t.close();
});

async function connect(user: { accessToken: string }): Promise<TestWsClient> {
  const ws = await connectWs(t, user);
  open.push(ws);
  await ws.next('hello');
  return ws;
}

describe('connexion', () => {
  it('refuse une connexion sans jeton ou avec un jeton invalide (HTTP 401)', async () => {
    await expect(TestWsClient.connect(`${t.baseUrl?.replace('http', 'ws')}/v1/ws`)).rejects.toBeInstanceOf(WsConnectError);
    const err = await TestWsClient.connect(t.wsUrl('abc.def.ghi')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WsConnectError);
    expect((err as WsConnectError).status).toBe(401);
  });

  it('accueille le joueur avec son identifiant et l\'heure du serveur', async () => {
    const m = await createMember(t);
    const ws = await connectWs(t, m);
    open.push(ws);
    const hello = await ws.next('hello');
    expect(hello).toMatchObject({ userId: m.userId });
    expect(typeof hello.serverTime).toBe('number');
    expect(t.app.realtime.isOnline(m.userId)).toBe(true);
  });

  it('un invité se connecte aussi', async () => {
    const g = await createGuest(t);
    await connect(g);
    expect(t.app.realtime.connectionsOf(g.userId)).toHaveLength(1);
  });
});

describe('messages', () => {
  it('ping → pong avec re', async () => {
    const ws = await connect(await createMember(t));
    ws.send({ t: 'ping', id: 'p1' });
    const pong = await ws.next('pong');
    expect(pong.re).toBe('p1');
    expect(typeof pong.serverTime).toBe('number');
  });

  it('JSON illisible, enveloppe invalide, type inconnu', async () => {
    const ws = await connect(await createMember(t));
    ws.send('{pas du json');
    expect(await ws.next('error')).toMatchObject({ code: 'ws.invalid_message' });
    ws.send({ id: 'x1', data: 1 });
    expect(await ws.next('error')).toMatchObject({ code: 'ws.invalid_message', re: 'x1' });
    ws.send({ t: 'room.nope', id: 'x2' });
    expect(await ws.next('error')).toMatchObject({ code: 'ws.unknown_type', re: 'x2', params: { t: 'room.nope' } });
  });

  it('un gestionnaire enregistré reçoit le message validé et répond', async () => {
    const m = await createMember(t);
    const ws = await connect(m);
    ws.send({ t: 'test.echo', id: 'e1', text: 'bonjour' });
    expect(await ws.next('test.echoed')).toEqual({ t: 'test.echoed', re: 'e1', text: 'bonjour', userId: m.userId });
    ws.send({ t: 'test.echo', id: 'e2', text: 42 });
    const err = await ws.next('error');
    expect(err).toMatchObject({ re: 'e2', code: 'common.validation' });
    expect(JSON.stringify(err.params)).toContain('text');
  });

  it('les erreurs des gestionnaires deviennent des codes ; une panne reste muette', async () => {
    const ws = await connect(await createMember(t));
    ws.send({ t: 'test.fail', id: 'f1' });
    expect(await ws.next('error')).toEqual({ t: 'error', re: 'f1', code: 'common.forbidden', params: { why: 'test' } });
    ws.send({ t: 'test.crash', id: 'f2' });
    expect(await ws.next('error')).toEqual({ t: 'error', re: 'f2', code: 'common.internal', params: {} });
  });

  it('les messages d\'une connexion sont traités dans l\'ordre d\'arrivée', async () => {
    const ws = await connect(await createMember(t));
    ws.send({ t: 'test.slow', n: 1, delayMs: 60 });
    ws.send({ t: 'test.slow', n: 2, delayMs: 0 });
    ws.send({ t: 'test.slow', n: 3, delayMs: 20 });
    const order = [(await ws.next('test.done')).n, (await ws.next('test.done')).n, (await ws.next('test.done')).n];
    expect(order).toEqual([1, 2, 3]);
  });

  it('un gestionnaire ne s\'enregistre qu\'une fois', () => {
    expect(() => t.app.registerWsHandler('ping', clientMessage('ping', {}), () => undefined)).toThrow(/déjà enregistré/);
  });

  it('limite le débit d\'une connexion', async () => {
    const ws = await connect(await createMember(t));
    for (let i = 0; i < 60; i++) ws.send({ t: 'ping', id: `r${i}` });
    const limited = await ws.next((m) => m.t === 'error' && m.code === 'ws.rate_limited');
    expect(limited).toBeDefined();
  });
});

describe('envois', () => {
  it('sendToUser atteint toutes les connexions du joueur, et lui seul', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const phone = await connect(a);
    const tablet = await connect(a);
    const other = await connect(b);
    expect(t.app.realtime.sendToUser(a.userId, { t: 'test.hi', n: 1 })).toBe(2);
    expect(await phone.next('test.hi')).toMatchObject({ n: 1 });
    expect(await tablet.next('test.hi')).toMatchObject({ n: 1 });
    await new Promise((r) => setTimeout(r, 30));
    expect(other.has('test.hi')).toBe(false);
  });

  it('broadcast et sujets (salon, partie)', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const wa = await connect(a);
    const wb = await connect(b);
    expect(t.app.realtime.broadcast({ t: 'test.all' })).toBeGreaterThanOrEqual(2);
    await wa.next('test.all');
    await wb.next('test.all');

    t.app.realtime.subscribeUser(a.userId, 'room:ABCDEF');
    expect(t.app.realtime.publish('room:ABCDEF', { t: 'room.update', seats: 2 })).toBe(1);
    expect(await wa.next('room.update')).toMatchObject({ seats: 2 });
    t.app.realtime.unsubscribeUser(a.userId, 'room:ABCDEF');
    expect(t.app.realtime.publish('room:ABCDEF', { t: 'room.update' })).toBe(0);
  });
});

describe('présence', () => {
  it('en ligne / hors ligne : les amis sont prévenus et last_seen_at est noté', async () => {
    const a = await createMember(t);
    const friend = await createMember(t);
    const stranger = await createMember(t);
    const friends = new Map([
      [a.userId, [friend.userId]],
      [friend.userId, [a.userId]],
    ]);
    t.app.realtime.setPresenceAudience(async (id) => friends.get(id) ?? []);
    const wf = await connect(friend);
    // À l'ouverture, l'ami reçoit l'état de ses amis : a n'est encore jamais venu.
    expect(await wf.next('presence.update')).toEqual({
      t: 'presence.update',
      users: [{ userId: a.userId, online: false, lastSeenAt: null }],
    });
    const ws = await connect(stranger);

    const wa = await connect(a);
    expect(await wf.next('presence.update')).toEqual({
      t: 'presence.update',
      users: [{ userId: a.userId, online: true, lastSeenAt: null }],
    });
    // À l'ouverture, a reçoit l'état de ses amis.
    expect(await wa.next('presence.update')).toEqual({
      t: 'presence.update',
      users: [{ userId: friend.userId, online: true, lastSeenAt: null }],
    });

    await wa.close();
    open.splice(open.indexOf(wa), 1);
    const offline = await wf.next('presence.update');
    expect(offline.users).toEqual([{ userId: a.userId, online: false, lastSeenAt: expect.any(String) }]);
    expect(t.app.realtime.isOnline(a.userId)).toBe(false);
    const seen = await t.db.pool.query('SELECT last_seen_at FROM users WHERE id = $1', [a.userId]);
    expect(seen.rows[0]?.last_seen_at).not.toBeNull();
    expect(ws.has('presence.update')).toBe(false);
  });

  it('deux connexions : hors ligne seulement quand la dernière se ferme', async () => {
    const a = await createMember(t);
    const events: boolean[] = [];
    t.app.realtime.onPresenceChange((id, online) => {
      if (id === a.userId) events.push(online);
    });
    const one = await connect(a);
    const two = await connect(a);
    await one.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(t.app.realtime.isOnline(a.userId)).toBe(true);
    await two.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([true, false]);
  });
});

describe('fermetures', () => {
  it('la déconnexion coupe la WebSocket de la session (4403)', async () => {
    const m = await createMember(t);
    const ws = await connect(m);
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: m.headers });
    expect(res.statusCode).toBe(200);
    expect((await ws.closed).code).toBe(WS_CLOSE_CODES.sessionRevoked);
  });

  it('une session fermée ailleurs (CLI) est coupée au contrôle suivant', async () => {
    const m = await createMember(t);
    const ws = await connect(m);
    await revokeAllSessions(t.db.pool, m.userId, t.clock.now());
    expect(await closeRevokedSockets(t.app)).toBe(1);
    expect((await ws.closed).code).toBe(WS_CLOSE_CODES.sessionRevoked);
  });

  it('une connexion qui ne répond plus au ping est coupée', async () => {
    const m = await createMember(t);
    const socket = new WebSocket(t.wsUrl(m.accessToken), { autoPong: false });
    const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(t.app.realtime.connectionsOf(m.userId)).toHaveLength(1);
    t.app.realtime.sweep(); // ping envoyé, pas de pong
    await new Promise((r) => setTimeout(r, 50));
    t.app.realtime.sweep(); // toujours rien : coupée
    expect(await closed).toBe(1006);
    await new Promise((r) => setTimeout(r, 30));
    expect(t.app.realtime.connectionsOf(m.userId)).toHaveLength(0);
  });

  it('une connexion vivante survit aux contrôles', async () => {
    const m = await createMember(t);
    const ws = await connect(m);
    t.app.realtime.sweep();
    await new Promise((r) => setTimeout(r, 50));
    t.app.realtime.sweep();
    await new Promise((r) => setTimeout(r, 50));
    ws.send({ t: 'ping', id: 'alive' });
    expect((await ws.next('pong')).re).toBe('alive');
  });
});
