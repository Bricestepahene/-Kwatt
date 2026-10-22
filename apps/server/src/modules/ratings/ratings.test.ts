import { MyRatingsResponseSchema } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createGuest, createMember, type TestApp } from '../../test/helpers.js';
import { recordRatedResult } from './service.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'ratings' });
});
afterAll(async () => {
  await t.close();
});

/** Partie terminée (rating_history renvoie à games). */
async function newGame(variant = 'dames10'): Promise<string> {
  const r = await t.db.pool.query<{ id: string }>(
    `INSERT INTO games (context, variant, rules, rules_version, ranked, status) VALUES ('room', $1, '{}', 'test', true, 'finished') RETURNING id`,
    [variant],
  );
  return r.rows[0]!.id;
}

describe('recordRatedResult (C1)', () => {
  it('crée la force à 900 et compte un duel entre deux joueurs', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const gameId = await newGame();
    const r = await recordRatedResult(t.db.pool, {
      gameId,
      variant: 'dames10',
      participants: [
        { userId: a.userId, place: 1 },
        { userId: b.userId, place: 2 },
      ],
    });
    // Deux joueurs à 900, K = 32 : ±16.
    expect(r[a.userId]).toEqual({ before: 900, after: 916, delta: 16, levelBefore: 2, levelAfter: 2 });
    expect(r[b.userId]).toEqual({ before: 900, after: 884, delta: -16, levelBefore: 2, levelAfter: 2 });
    const row = await t.db.pool.query('SELECT rating, games_played, wins, losses FROM player_ratings WHERE user_id = $1', [a.userId]);
    expect(row.rows[0]).toMatchObject({ rating: 916, games_played: 1, wins: 1, losses: 0 });
  });

  it('est idempotent par partie et par joueur', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const gameId = await newGame('dames8');
    const input = {
      gameId,
      variant: 'dames8' as const,
      participants: [
        { userId: a.userId, place: 1 },
        { userId: b.userId, place: 1 },
      ],
    };
    const first = await recordRatedResult(t.db.pool, input);
    const second = await recordRatedResult(t.db.pool, input);
    expect(second).toEqual(first);
    const row = await t.db.pool.query('SELECT games_played, draws FROM player_ratings WHERE user_id = $1 AND variant = $2', [
      a.userId,
      'dames8',
    ]);
    expect(row.rows[0]).toMatchObject({ games_played: 1, draws: 1 });
  });

  it('une machine sert d’adversaire sans ligne de force', async () => {
    const a = await createMember(t);
    const r = await recordRatedResult(t.db.pool, {
      gameId: await newGame(),
      variant: 'dames10',
      participants: [
        { userId: a.userId, place: 2 },
        { userId: null, machineRating: 1300, place: 1 },
      ],
    });
    // Perdre contre plus fort coûte peu : 32 × (0 − 0,09) ≈ −3.
    expect(r[a.userId]!.delta).toBe(-3);
    const n = await t.db.pool.query('SELECT count(*)::int AS n FROM player_ratings WHERE user_id IS NULL');
    expect(n.rows[0].n).toBe(0);
  });

  it('Ludo à plusieurs : duels deux à deux selon les places', async () => {
    const [a, b, c] = await Promise.all([createMember(t), createMember(t), createMember(t)]);
    const r = await recordRatedResult(t.db.pool, {
      gameId: await newGame('ludo_classique'),
      variant: 'ludo_classique',
      participants: [
        { userId: a.userId, place: 1 },
        { userId: b.userId, place: 2 },
        { userId: c.userId, place: 3 },
      ],
    });
    expect(r[a.userId]!.delta).toBe(16);
    expect(r[b.userId]!.delta).toBe(0);
    expect(r[c.userId]!.delta).toBe(-16);
  });
});

describe('GET /v1/ratings/me', () => {
  it('liste les variantes jouées avec niveau, échelon et bilan', async () => {
    const a = await createMember(t);
    await recordRatedResult(t.db.pool, {
      gameId: await newGame(),
      variant: 'dames10',
      participants: [
        { userId: a.userId, place: 1 },
        { userId: null, machineRating: 900, place: 2 },
      ],
    });
    const res = await t.app.inject({ method: 'GET', url: '/v1/ratings/me', headers: a.headers });
    expect(res.statusCode).toBe(200);
    const body = MyRatingsResponseSchema.parse(res.json());
    expect(body.items).toEqual([
      { variant: 'dames10', rating: 916, level: 2, rank: 'apprenti', gamesPlayed: 1, wins: 1, draws: 0, losses: 0, pointsToNextLevel: 4 },
    ]);
  });

  it('refuse un invité', async () => {
    const g = await createGuest(t);
    const res = await t.app.inject({ method: 'GET', url: '/v1/ratings/me', headers: g.headers });
    expect(res.statusCode).toBe(403);
  });
});
