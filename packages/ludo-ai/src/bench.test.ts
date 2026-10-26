import { applyLegalMove, applyRoll, legalMoves, newGame } from '@kwatt/rules-ludo';
import { describe, expect, it } from 'vitest';
import { randomAgent } from './agents/random.js';
import { playGame, runMatch } from './bench/match.js';
import { eloFromScore, meanInterval, Sprt, wilson } from './bench/stats.js';
import { CALIBRATION, playerWinProbability } from './calibration.js';
import { GOLDEN_SET, goldenGame, goldenJsonl } from './golden.js';
import { isLinearModel, LEARNED_FEATURES, linearEvaluator, stateFeatures, type LinearModel } from './learned.js';
import { createRng, hashNumbers, sample } from './rng.js';
import { LEVELS } from './types.js';

describe('générateur à graine', () => {
  it('reproductible, uniforme, et indépendant de Math.random', () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(Array.from({ length: 1000 }, () => b.next())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
    expect(createRng(43).next()).not.toBe(createRng(42).next());
    const counts = [0, 0, 0];
    const r = createRng(1);
    for (let i = 0; i < 3000; i++) counts[sample([{ value: 0, p: 0.5 }, { value: 1, p: 0.25 }, { value: 2, p: 0.25 }], r)]!++;
    expect(counts[0]! / 3000).toBeCloseTo(0.5, 1);
    expect(hashNumbers([1, 2, 3])).toBe(hashNumbers([1, 2, 3]));
    expect(hashNumbers([1, 2, 3])).not.toBe(hashNumbers([3, 2, 1]));
  });
});

describe('statistiques', () => {
  it('intervalle de Wilson', () => {
    const w = wilson(50, 100);
    expect(w.p).toBe(0.5);
    expect(w.low).toBeCloseTo(0.4038, 3);
    expect(w.high).toBeCloseTo(0.5962, 3);
    expect(wilson(0, 0)).toEqual({ p: 0, low: 0, high: 1 });
    expect(wilson(10, 10).high).toBe(1);
  });

  it('moyenne et écart de force', () => {
    const m = meanInterval([0, 1, 0, 1]);
    expect(m.mean).toBe(0.5);
    expect(m.low).toBeLessThan(0.5);
    expect(eloFromScore(0.5)).toBe(0);
    expect(eloFromScore(0.75)).toBeCloseTo(190.85, 1);
  });

  it('SPRT : accepte H1 sur une série de victoires, H0 sur une série de défaites', () => {
    const up = new Sprt({ p0: 0.5, p1: 0.6 });
    let v = up.verdict();
    while (v === 'continue') v = up.add(1);
    expect(v).toBe('H1');
    expect(up.n).toBeLessThan(20);
    const down = new Sprt({ p0: 0.5, p1: 0.6 });
    v = 'continue';
    while (v === 'continue') v = down.add(0);
    expect(v).toBe('H0');
    expect(() => new Sprt({ p0: 0.6, p1: 0.5 })).toThrow();
  });
});

describe('banc d’essai', () => {
  const random = { label: 'hasard', agent: randomAgent() };

  it('une partie : places cohérentes, même graine, même partie', () => {
    const g = playGame({ preset: 'classique', players: 3 }, [random, random, random], [0, 1, 2], 11, 12);
    expect([...g.places].sort()).toEqual([1, 2, 3]);
    expect(g.winners).toEqual([g.ranking[0]]);
    expect(playGame({ preset: 'classique', players: 3 }, [random, random, random], [0, 1, 2], 11, 12)).toEqual(g);
  });

  it('places tournées et lancers communs : chaque donne jouée à toutes les places', () => {
    const r = runMatch({ game: { preset: 'rapide', players: 2 }, lineup: [random, { ...random, label: 'hasard 2' }], deals: 5, seed: 3 });
    expect(r.games).toBe(10);
    expect(r.results.map((g) => g.seating)).toEqual(Array.from({ length: 5 }, () => [[0, 1], [1, 0]]).flat());
    expect(r.players[0]!.wins + r.players[1]!.wins).toBe(10);
    expect(r.players[0]!.meanPlace + r.players[1]!.meanPlace).toBeCloseTo(3, 9);
    // Répartition sur plusieurs processus : les donnes paires puis impaires redonnent le tout.
    const even = runMatch({ game: { preset: 'rapide', players: 2 }, lineup: [random, random], deals: 5, seed: 3, shard: { index: 0, count: 2 } });
    const odd = runMatch({ game: { preset: 'rapide', players: 2 }, lineup: [random, random], deals: 5, seed: 3, shard: { index: 1, count: 2 } });
    expect(even.games + odd.games).toBe(10);
  });

  it('équipes : le camp gagnant compte pour ses deux joueurs', () => {
    const g = playGame({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] }, [random, random, random, random], [0, 1, 2, 3], 5, 6);
    expect(g.winners).toHaveLength(2);
    expect(g.winners[1]! - g.winners[0]!).toBe(2);
  });

  it('arrêt anticipé par le SPRT', () => {
    const r = runMatch({
      game: { preset: 'classique', players: 2 },
      lineup: [{ label: 'coriace', level: 'coriace' }, random],
      deals: 200,
      seed: 1,
      sprt: { p0: 0.5, p1: 0.7 },
    });
    expect(r.sprt?.verdict).toBe('H1');
    expect(r.games).toBeLessThan(400);
  });
});

describe('évaluation apprise', () => {
  const model: LinearModel = { format: 'kwatt-ludo-eval', version: 1, preset: 'classique', features: [...LEARNED_FEATURES], weights: [4, -1, 2, 1, -1.5], bias: 0 };

  it('caractéristiques entre 0 et 1, modèle validé, évaluation antisymétrique à deux', () => {
    let g = newGame({ preset: 'classique', players: 2 });
    const rng = createRng(4);
    for (let i = 0; i < 200 && g.phase !== 'over'; i++) {
      if (g.phase === 'roll') g = applyRoll(g, 1 + rng.int(6));
      else {
        const m = legalMoves(g);
        g = applyLegalMove(g, m[rng.int(m.length)]!);
      }
      for (const f of stateFeatures(g, 0)) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
    expect(isLinearModel(model)).toBe(true);
    expect(isLinearModel({ ...model, weights: [1] })).toBe(false);
    expect(isLinearModel({ ...model, features: ['inconnu', 'base', 'home', 'corridor', 'exposed'] })).toBe(false);
    const u = linearEvaluator(model)(g);
    expect(u[0]! + u[1]!).toBeCloseTo(0, 12);
    expect(() => linearEvaluator({ ...model, version: 2 } as unknown as LinearModel)).toThrow();
  });
});

describe('fixtures d’or', () => {
  it('reproductibles et cohérentes avec le moteur', () => {
    const a = goldenGame({ preset: 'classique', players: 2 }, 1);
    expect(goldenGame({ preset: 'classique', players: 2 }, 1)).toEqual(a);
    expect(a.steps.at(-1)!.state.phase).toBe('over');
    // Rejeu : chaque coup enregistré est un index dans les coups légaux du pas précédent.
    let g = newGame({ preset: 'classique', players: 2 });
    for (const step of a.steps) {
      if (step.roll !== undefined) g = applyRoll(g, step.roll);
      else g = applyLegalMove(g, legalMoves(g)[step.move!]!);
      expect(g.tokens).toEqual(step.state.tokens);
      expect(legalMoves(g).length).toBe(step.legal.length);
    }
  });

  it('le jeu versionné couvre les variantes du simulateur Python', () => {
    expect(GOLDEN_SET.map((s) => s.options.preset)).toEqual(expect.arrayContaining(['classique', 'rapide', 'six']));
    const lines = goldenJsonl().trim().split('\n');
    expect(lines).toHaveLength(GOLDEN_SET.reduce((n, s) => n + s.seeds.length, 0));
  });
});

describe('table des probabilités pour les cotes', () => {
  it('modèle de Luce : moins de chances à plusieurs, bornées, cohérentes à 2', () => {
    for (const level of LEVELS) {
      const p2 = playerWinProbability('classique', 2, level);
      const p4 = playerWinProbability('classique', 4, level);
      expect(p4).toBeLessThan(p2);
      expect(p2).toBeGreaterThanOrEqual(0.02);
      expect(p2).toBeLessThanOrEqual(0.95);
    }
    const custom = { ...CALIBRATION, table: { ...CALIBRATION.table, classique: { ...CALIBRATION.table.classique, moyen: { p2: 0.6, low: 0.55, high: 0.65, games: 100 } } } };
    expect(playerWinProbability('classique', 2, 'moyen', custom)).toBeCloseTo(0.6, 12);
    // 1 / (1 + 3 × 0,4/0,6) = 1/3.
    expect(playerWinProbability('classique', 4, 'moyen', custom)).toBeCloseTo(1 / 3, 12);
    expect(() => playerWinProbability('classique', 1, 'moyen')).toThrow();
  });

  it('« Ton niveau » : une chance sur n', () => {
    expect(playerWinProbability('six', 2, 'ton_niveau')).toBeCloseTo(0.5, 12);
    expect(playerWinProbability('six', 6, 'ton_niveau')).toBeCloseTo(1 / 6, 12);
  });
});
