/**
 * Amis (écran 12, contrat C6), avec une vraie base : code d'ami, demandes croisées,
 * refus, retrait, recherche (comptes jeunes invisibles des inconnus), blocage, présence et
 * activité des amis.
 */
import type { FriendCodeTarget, FriendRequestResult, FriendRequestsResponse, FriendSearchResponse, FriendsResponse, MyFriendCode } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { transaction } from '../../db/pool.js';
import { buildTestApp, connectWs, createMember, type TestApp, type TestMember, type TestUser } from '../../test/helpers.js';

vi.setConfig({ testTimeout: 30_000 });

let t: TestApp;

beforeAll(async () => {
  t = await buildTestApp({ suite: 'friends', listen: true });
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

async function notifications(user: TestUser): Promise<{ kind: string; params: Record<string, unknown> }[]> {
  const r = await t.app.db.query<{ kind: string; params: Record<string, unknown> }>('SELECT kind, params FROM notifications WHERE user_id = $1 ORDER BY created_at', [user.userId]);
  return r.rows;
}

async function makeFriends(a: TestMember, b: TestMember): Promise<void> {
  await call(a, 'POST', '/v1/friends/requests', { userId: b.userId });
  await call(b, 'POST', `/v1/friends/requests/${a.userId}/accept`);
}

describe('Amis', () => {
  it('code d’ami stable, retrouvé par le lien, demande puis acceptation', async () => {
    const a = await createMember(t, { pseudo: `mireille_${Date.now() % 1e6}` });
    const b = await createMember(t);
    const { code } = await call<MyFriendCode>(a, 'GET', '/v1/friends/code');
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect((await call<MyFriendCode>(a, 'GET', '/v1/friends/code')).code).toBe(code);

    const target = await call<FriendCodeTarget>(b, 'GET', `/v1/friends/code/${code.slice(0, 3)}-${code.slice(3).toLowerCase()}`);
    expect(target).toMatchObject({ userId: a.userId, pseudo: a.pseudo, relation: 'none', self: false });
    expect((await call<FriendCodeTarget>(a, 'GET', `/v1/friends/code/${code}`)).self).toBe(true);
    expect(await errorOf(b, 'GET', '/v1/friends/code/ZZZZZZ')).toEqual({ status: 404, code: 'friends.not_found' });

    expect(await call<FriendRequestResult>(b, 'POST', '/v1/friends/requests', { code })).toEqual({ userId: a.userId, relation: 'outgoing' });
    expect((await notifications(a)).at(-1)).toEqual({ kind: 'invites.friend_request', params: { from: b.pseudo, userId: b.userId } });

    const reqs = await call<FriendRequestsResponse>(a, 'GET', '/v1/friends/requests');
    expect(reqs.incoming).toHaveLength(1);
    expect(reqs.incoming[0]).toMatchObject({ userId: b.userId, direction: 'incoming', gamesTogether: 0, quarter: null, league: null });
    expect((await call<FriendsResponse>(a, 'GET', '/v1/friends')).incomingRequests).toBe(1);

    expect(await call<FriendRequestResult>(a, 'POST', `/v1/friends/requests/${b.userId}/accept`)).toEqual({ userId: b.userId, relation: 'friend' });
    expect((await notifications(b)).at(-1)).toEqual({ kind: 'friends.accepted', params: { from: a.pseudo, userId: a.userId } });
    const list = await call<FriendsResponse>(b, 'GET', '/v1/friends');
    expect(list.items.map((f) => f.userId)).toEqual([a.userId]);
    expect(list.incomingRequests).toBe(0);
  });

  it('une demande croisée vaut acceptation ; refuser, annuler, retirer', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const c = await createMember(t);
    await call(a, 'POST', '/v1/friends/requests', { userId: b.userId });
    expect(await call<FriendRequestResult>(b, 'POST', '/v1/friends/requests', { userId: a.userId })).toEqual({ userId: a.userId, relation: 'friend' });

    await call(c, 'POST', '/v1/friends/requests', { userId: a.userId });
    await call(a, 'POST', `/v1/friends/requests/${c.userId}/decline`);
    expect(await errorOf(a, 'POST', `/v1/friends/requests/${c.userId}/accept`)).toEqual({ status: 404, code: 'friends.no_request' });
    // On n'accepte pas sa propre demande.
    await call(c, 'POST', '/v1/friends/requests', { userId: a.userId });
    expect(await errorOf(c, 'POST', `/v1/friends/requests/${a.userId}/accept`)).toEqual({ status: 404, code: 'friends.no_request' });
    await call(c, 'POST', `/v1/friends/requests/${a.userId}/decline`);
    expect((await call<FriendRequestsResponse>(a, 'GET', '/v1/friends/requests')).incoming).toEqual([]);

    await call(b, 'DELETE', `/v1/friends/${a.userId}`);
    expect((await call<FriendsResponse>(a, 'GET', '/v1/friends')).items).toEqual([]);
    expect(await errorOf(a, 'POST', '/v1/friends/requests', { userId: a.userId })).toEqual({ status: 400, code: 'friends.self' });
  });

  it('recherche : comptes jeunes invisibles des inconnus, bloqués absents', async () => {
    const stamp = String(Date.now() % 1e6);
    const me = await createMember(t, { pseudo: `kamga_${stamp}` });
    const adult = await createMember(t, { pseudo: `yan_a_${stamp}` });
    const teen = await createMember(t, { pseudo: `yan_t_${stamp}`, birthYear: new Date().getFullYear() - 15 });
    const blocker = await createMember(t, { pseudo: `yan_b_${stamp}` });
    await t.app.db.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [blocker.userId, me.userId]);

    const found = await call<FriendSearchResponse>(me, 'GET', `/v1/friends/search?q=yan_`);
    const ids = found.items.map((i) => i.userId);
    expect(ids).toContain(adult.userId);
    expect(ids).not.toContain(teen.userId);
    expect(ids).not.toContain(blocker.userId);
    expect(found.items.find((i) => i.userId === adult.userId)?.relation).toBe('none');

    // Le compte jeune ne reçoit pas de demande d'un inconnu (sauf par son code, partagé exprès).
    expect(await errorOf(me, 'POST', '/v1/friends/requests', { userId: teen.userId })).toEqual({ status: 404, code: 'friends.not_found' });
    const { code } = await call<MyFriendCode>(teen, 'GET', '/v1/friends/code');
    expect((await call<FriendRequestResult>(me, 'POST', '/v1/friends/requests', { code })).relation).toBe('outgoing');
    // Une demande en attente suffit : l'ami devient visible une fois accepté.
    await call(teen, 'POST', `/v1/friends/requests/${me.userId}/accept`);
    expect((await call<FriendSearchResponse>(me, 'GET', `/v1/friends/search?q=yan_t_${stamp}`)).items[0]?.relation).toBe('friend');

    expect(await errorOf(me, 'POST', '/v1/friends/requests', { userId: blocker.userId })).toEqual({ status: 404, code: 'friends.not_found' });
    expect(await errorOf(blocker, 'POST', '/v1/friends/requests', { userId: me.userId })).toEqual({ status: 403, code: 'friends.blocked' });
  });

  it('présence branchée sur les amis, activité « joue » avec le coup', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const c = await createMember(t);
    await makeFriends(a, b);
    const wb = await connectWs(t, b);
    expect(await wb.next('presence.update')).toMatchObject({ users: [{ userId: a.userId, online: false }] });
    const wa = await connectWs(t, a);
    expect(await wb.next('presence.update')).toMatchObject({ users: [{ userId: a.userId, online: true, lastSeenAt: null }] });

    const cfg = await transaction(t.app.db, (tx) =>
      t.app.games.createGame(tx, {
        context: 'room',
        variant: 'dames10',
        seats: [
          { userId: a.userId, name: a.pseudo, staking: false, guest: false },
          { userId: c.userId, name: c.pseudo, staking: false, guest: false },
        ],
        ranked: false,
        stake: 0,
        clock: null,
        turnMs: null,
      }),
    );
    // La partie démarre après la validation de la transaction : on l'attend.
    await vi.waitFor(async () => {
      const list = await call<FriendsResponse>(b, 'GET', '/v1/friends');
      expect(list.items[0]).toMatchObject({ userId: a.userId, online: true, activity: { kind: 'playing', gameId: cfg.id, family: 'dames', progress: 0 } });
    });

    // Nouveaux amis : la présence arrive tout de suite.
    await call(c, 'POST', '/v1/friends/requests', { userId: b.userId });
    await call(b, 'POST', `/v1/friends/requests/${c.userId}/accept`);
    expect(await wb.next('presence.update')).toMatchObject({ users: [{ userId: c.userId, online: false }] });

    await wa.close();
    await wb.close();
    const actor = await t.app.games.require(cfg.id);
    await actor.resign(c.userId);
    await t.app.games.settled(cfg.id);
  });
});
