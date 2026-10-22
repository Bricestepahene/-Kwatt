import { DAILY_PUZZLE_REWARD, dayNumber } from '@kwatt/domain';
import { DailyPuzzleResponseSchema, DailyPuzzleSolveResponseSchema, type DailyPuzzleResponse } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createMember, type TestApp, type TestMember } from '../../test/helpers.js';
import { balanceOf } from '../economy/ledger.js';
import { checkSolution, dailyFor, puzzleOfDay, puzzlesOf, solveDaily } from './service.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'puzzles' });
});
afterAll(async () => {
  await t.close();
});

async function daily(m: TestMember, variant = 'dames10'): Promise<DailyPuzzleResponse> {
  const res = await t.app.inject({ method: 'GET', url: `/v1/puzzles/daily?variant=${variant}`, headers: m.headers });
  expect(res.statusCode).toBe(200);
  return DailyPuzzleResponseSchema.parse(res.json());
}

function solve(m: TestMember, payload: object) {
  return t.app.inject({ method: 'POST', url: '/v1/puzzles/daily/solve', headers: m.headers, payload });
}

/** Coups du joueur dans la solution (un sur deux, à partir du premier). */
const ownMoves = (solution: string[]) => solution.filter((_, i) => i % 2 === 0);

describe('problèmes livrés', () => {
  it('chaque solution est acceptée, avec ou sans les réponses forcées', () => {
    for (const variant of ['dames10', 'dames8'] as const) {
      const list = puzzlesOf(variant);
      expect(list.length).toBeGreaterThan(10);
      for (const p of list.slice(0, 20)) {
        expect(checkSolution(p, p.solution)).toBe(true);
        expect(checkSolution(p, ownMoves(p.solution))).toBe(true);
      }
    }
  });

  it('un autre coup est refusé', () => {
    const p = puzzleOfDay('dames10', 20_000);
    expect(checkSolution(p, ['1-2'])).toBe(false);
  });
});

describe('GET /v1/puzzles/daily et POST /solve', () => {
  it('même problème pour tous le même jour ; +10 cauris une seule fois', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const pa = await daily(a);
    const pb = await daily(b);
    expect(pa.puzzle.id).toBe(pb.puzzle.id);
    expect(pa).toMatchObject({ solved: false, streak: 0, daysToReward: 7, reward: DAILY_PUZZLE_REWARD });

    const wrong = await solve(a, { dayKey: pa.dayKey, moves: ['1-2'] });
    expect(DailyPuzzleSolveResponseSchema.parse(wrong.json())).toMatchObject({ correct: false, reward: 0 });

    const ok = DailyPuzzleSolveResponseSchema.parse((await solve(a, { dayKey: pa.dayKey, moves: ownMoves(pa.puzzle.solution) })).json());
    expect(ok).toMatchObject({ correct: true, reward: 10, streak: 1, daysToReward: 6, card: null, alreadySolved: false });
    expect(await balanceOf(t.db.pool, a.userId)).toBe(510);

    const again = DailyPuzzleSolveResponseSchema.parse((await solve(a, { dayKey: pa.dayKey, moves: pa.puzzle.solution })).json());
    expect(again).toMatchObject({ correct: true, reward: 0, alreadySolved: true });
    expect(await balanceOf(t.db.pool, a.userId)).toBe(510);
    expect((await daily(a)).solved).toBe(true);
  });

  it('refuse un autre jour que celui du Cameroun', async () => {
    const a = await createMember(t);
    const res = await solve(a, { dayKey: '2001-01-01', moves: ['32-28'] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('puzzle.wrong_day');
  });

  it('série de 7 jours : une carte rare du catalogue', async () => {
    await t.db.pool.query(`INSERT INTO items (code, kind, rarity, price) VALUES ('card_test_rare', 'card', 'rare', NULL)`);
    const a = await createMember(t);
    const start = t.clock.now().getTime();
    let last = null;
    // Le jeton d'accès expire au bout de 15 min : on passe par le service, jour après jour.
    for (let i = 0; i < 7; i++) {
      const p = await dailyFor(t.db.pool, a.userId, 'dames8', t.clock.now());
      last = await solveDaily(t.db.pool, a.userId, { dayKey: p.dayKey, variant: 'dames8', moves: ownMoves(p.puzzle.solution) }, t.clock.now());
      expect(last.correct).toBe(true);
      t.clock.advance(86_400_000);
    }
    expect(last).toMatchObject({ streak: 7, card: 'card_test_rare', daysToReward: 7 });
    expect(dayNumber(t.clock.now().getTime()) - dayNumber(start)).toBe(7);
    // Un jour sauté : la série retombe à 0.
    t.clock.advance(86_400_000);
    expect((await dailyFor(t.db.pool, a.userId, 'dames10', t.clock.now())).streak).toBe(0);
  });
});
