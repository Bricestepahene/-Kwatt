/**
 * Signaler ou bloquer (écran 38), avec une vraie base : partie jointe d'office, motif
 * « Autre chose » avec message, un seul signalement ouvert, blocage (amitié défaite, défis et
 * invitations refusés), file de modération et avertissement.
 */
import type { BlockListResponse, ReportContext, ReportResult } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { transaction } from '../../db/pool.js';
import { buildTestApp, createMember, type TestApp, type TestMember, type TestUser } from '../../test/helpers.js';
import { areFriends, isBlocked } from '../friends/relations.js';

vi.setConfig({ testTimeout: 30_000 });

const ADMIN_TOKEN = 'admin-token-de-test-0123456789abcdefghijkl';
const admin = { authorization: `Bearer ${ADMIN_TOKEN}` };
let t: TestApp;

beforeAll(async () => {
  t = await buildTestApp({ suite: 'reports', env: { ADMIN_TOKEN } });
});
afterAll(async () => {
  await t.close();
});

async function call<T>(user: TestUser, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, status = 200): Promise<T> {
  const res = await t.app.inject({ method, url, headers: user.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}

async function errorOf(user: TestUser, method: 'GET' | 'POST', url: string, payload?: unknown): Promise<{ status: number; code: string }> {
  const res = await t.app.inject({ method, url, headers: user.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, code: res.json<{ error: { code: string } }>().error.code };
}

async function playTogether(a: TestMember, b: TestMember): Promise<string> {
  const cfg = await transaction(t.app.db, (tx) =>
    t.app.games.createGame(tx, {
      context: 'room',
      variant: 'dames10',
      seats: [
        { userId: a.userId, name: a.pseudo, staking: false, guest: false },
        { userId: b.userId, name: b.pseudo, staking: false, guest: false },
      ],
      ranked: false,
      stake: 0,
      clock: null,
      turnMs: null,
    }),
  );
  const actor = await t.app.games.require(cfg.id);
  await actor.resign(b.userId);
  await t.app.games.settled(cfg.id);
  return cfg.id;
}

describe('Signaler', () => {
  it('joint la dernière partie, bloque, et n’accepte qu’un signalement ouvert', async () => {
    const me = await createMember(t);
    const tchoumi = await createMember(t);
    await call(me, 'POST', '/v1/friends/requests', { userId: tchoumi.userId });
    await call(tchoumi, 'POST', `/v1/friends/requests/${me.userId}/accept`);
    const gameId = await playTogether(me, tchoumi);

    const ctx = await call<ReportContext>(me, 'GET', `/v1/reports/context/${tchoumi.userId}`);
    expect(ctx).toMatchObject({ userId: tchoumi.userId, blocked: false, pending: false, game: { gameId, family: 'dames', variant: 'dames10' } });

    // « Autre chose » demande un message.
    expect((await errorOf(me, 'POST', '/v1/reports', { userId: tchoumi.userId, reason: 'other', block: false })).code).toBe('common.validation');
    const res = await call<ReportResult>(me, 'POST', '/v1/reports', { userId: tchoumi.userId, reason: 'outside_help', block: true }, 201);
    expect(res).toMatchObject({ gameId, blocked: true });
    expect(await isBlocked(t.app.db, tchoumi.userId, me.userId)).toBe(true);
    expect(await areFriends(t.app.db, me.userId, tchoumi.userId)).toBe(false);
    expect(await errorOf(me, 'POST', '/v1/reports', { userId: tchoumi.userId, reason: 'insults', block: false })).toEqual({ status: 409, code: 'report.already_open' });
    expect((await call<ReportContext>(me, 'GET', `/v1/reports/context/${tchoumi.userId}`)).pending).toBe(true);

    // Le bloqué ne peut plus défier.
    expect((await errorOf(tchoumi, 'POST', '/v1/challenges', { toUserId: me.userId, game: 'dames', variant: 'dames10', stake: 0, format: 'simple' })).status).toBe(403);
    expect(await errorOf(me, 'POST', '/v1/reports', { userId: me.userId, reason: 'insults', block: false })).toEqual({ status: 400, code: 'report.self' });
  });

  it('liste et levée des blocages', async () => {
    const me = await createMember(t);
    const other = await createMember(t);
    await call(me, 'POST', '/v1/blocks', { userId: other.userId });
    await call(me, 'POST', '/v1/blocks', { userId: other.userId });
    const list = await call<BlockListResponse>(me, 'GET', '/v1/blocks');
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ userId: other.userId, pseudo: other.pseudo });
    await call(me, 'DELETE', `/v1/blocks/${other.userId}`);
    expect((await call<BlockListResponse>(me, 'GET', '/v1/blocks')).items).toEqual([]);
  });

  it('file de modération : avertir prévient le joueur signalé', async () => {
    const me = await createMember(t);
    const other = await createMember(t);
    const { reportId } = await call<ReportResult>(me, 'POST', '/v1/reports', { userId: other.userId, reason: 'other', message: 'Il insulte dans son pseudo', block: false }, 201);
    const queue = await t.app.inject({ method: 'GET', url: '/v1/admin/reports', headers: admin });
    const items = queue.json<{ items: { id: string; message: string; reportedId: string }[] }>().items;
    expect(items.find((i) => i.id === reportId)).toMatchObject({ message: 'Il insulte dans son pseudo', reportedId: other.userId });
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/reports', headers: me.headers })).statusCode).toBe(403);

    const done = await t.app.inject({ method: 'POST', url: `/v1/admin/reports/${reportId}/resolve`, headers: admin, payload: { decision: 'warned' } });
    expect(done.statusCode, done.body).toBe(200);
    const n = await t.app.db.query('SELECT kind, params FROM notifications WHERE user_id = $1', [other.userId]);
    expect(n.rows).toEqual([{ kind: 'account.warning', params: { reason: 'other' } }]);
    // Un signalement traité libère la paire.
    await call(me, 'POST', '/v1/reports', { userId: other.userId, reason: 'insults', block: false }, 201);
  });
});
