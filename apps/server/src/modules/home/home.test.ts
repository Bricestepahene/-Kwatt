/**
 * Accueil du hub (écran 07) : notifications à traiter, partie à reprendre, salons ouverts.
 */
import type { HomeView } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { transaction } from '../../db/pool.js';
import { buildTestApp, createMember, type TestApp } from '../../test/helpers.js';

vi.setConfig({ testTimeout: 30_000 });

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'home' });
});
afterAll(async () => {
  await t.close();
});

describe('Accueil', () => {
  it('partie à reprendre, tour à jouer, salon ouvert, notification non lue', async () => {
    const me = await createMember(t);
    const other = await createMember(t);
    const get = async () => {
      const res = await t.app.inject({ method: 'GET', url: '/v1/home', headers: me.headers });
      expect(res.statusCode, res.body).toBe(200);
      return res.json<HomeView>();
    };
    const empty = await get();
    expect(empty).toMatchObject({ unread: 0, todo: 0, resume: null, nextMatch: null });

    const room = await t.app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: other.headers,
      payload: { game: 'ludo', variant: 'ludo_classique', name: 'Salon du quartier', seats: 4, format: 'simple', stake: 0 },
    });
    expect(room.statusCode, room.body).toBe(201);
    const cfg = await transaction(t.app.db, (tx) =>
      t.app.games.createGame(tx, {
        context: 'room',
        variant: 'dames10',
        seats: [
          { userId: me.userId, name: me.pseudo, staking: false, guest: false },
          { userId: other.userId, name: other.pseudo, staking: false, guest: false },
        ],
        ranked: false,
        stake: 0,
        clock: null,
        turnMs: null,
      }),
    );
    await t.app.notifications.notify(t.app.db, me.userId, 'friends.accepted', { from: other.pseudo, userId: other.userId });
    const home = await get();
    expect(home.unread).toBe(1);
    expect(home.todo).toBe(1);
    expect(home.openRooms.ludo).toBeGreaterThanOrEqual(1);
    expect(home.resume).toMatchObject({ gameId: cfg.id, family: 'dames', myTurn: true, opponents: [other.pseudo] });
    const actor = await t.app.games.require(cfg.id);
    await actor.resign(other.userId);
    await t.app.games.settled(cfg.id);
  });
});
