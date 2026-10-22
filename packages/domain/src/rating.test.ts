import { describe, expect, it } from 'vitest';
import {
  START_RATING,
  duelChange,
  isRatedVariant,
  kFactor,
  rateDuel,
  rateMultiplayer,
  winProbability,
} from './rating.js';

describe('force façon Elo', () => {
  it('part de 900', () => {
    expect(START_RATING).toBe(900);
  });

  it('chances de gagner : p = 1 / (1 + 10^((adverse − toi) / 400))', () => {
    expect(winProbability(1500, 1500)).toBe(0.5);
    expect(winProbability(1500, 1100)).toBeCloseTo(1 / 1.1, 10);
    expect(winProbability(1100, 1500)).toBeCloseTo(1 / 11, 10);
    // Écran 34b : 1 482 contre 1 620 ≈ 31 %, 1 310 contre 1 150 ≈ 72 %.
    expect(Math.round(winProbability(1482, 1620) * 100)).toBe(31);
    expect(Math.round(winProbability(1310, 1150) * 100)).toBe(72);
  });

  it('K = 32 pendant les 30 premières parties, puis 20', () => {
    expect(kFactor(0)).toBe(32);
    expect(kFactor(29)).toBe(32);
    expect(kFactor(30)).toBe(20);
    expect(kFactor(500)).toBe(20);
  });

  it('duel à forces égales : ±16 avec K = 32, ±10 avec K = 20', () => {
    const r = rateDuel({ rating: 900, gamesPlayed: 0 }, { rating: 900, gamesPlayed: 0 }, 1);
    expect(r.a).toEqual({ before: 900, after: 916, delta: 16 });
    expect(r.b).toEqual({ before: 900, after: 884, delta: -16 });
    const s = rateDuel({ rating: 1200, gamesPlayed: 40 }, { rating: 1200, gamesPlayed: 40 }, 0);
    expect(s.a.delta).toBe(-10);
    expect(s.b.delta).toBe(10);
  });

  it('nulle : le plus faible gagne des points, le plus fort en perd', () => {
    const r = rateDuel({ rating: 1100, gamesPlayed: 50 }, { rating: 1500, gamesPlayed: 50 }, 0.5);
    expect(r.a.delta).toBeGreaterThan(0);
    expect(r.b.delta).toBeLessThan(0);
    expect(r.a.delta).toBe(Math.round(20 * (0.5 - 1 / 11)));
  });

  it('une défaite contre plus fort coûte peu, une victoire contre plus fort rapporte gros (écran 41)', () => {
    const weak = { rating: 1000, gamesPlayed: 40 };
    const strong = { rating: 1400, gamesPlayed: 40 };
    expect(duelChange(weak, strong, 0).delta).toBe(-2);
    expect(duelChange(weak, strong, 1).delta).toBe(18);
  });

  it("chaque joueur a son propre K : la somme n'est pas forcément nulle", () => {
    const r = rateDuel({ rating: 900, gamesPlayed: 3 }, { rating: 900, gamesPlayed: 100 }, 1);
    expect(r.a.delta).toBe(16);
    expect(r.b.delta).toBe(-10);
  });

  it('pas de « −0 »', () => {
    const r = rateDuel({ rating: 2000, gamesPlayed: 100 }, { rating: 900, gamesPlayed: 100 }, 1);
    expect(Object.is(r.a.delta, -0)).toBe(false);
    expect(r.a.delta).toBe(0);
  });

  it('Ludo à 4 : duels deux à deux selon les places, K ÷ 3', () => {
    const players = [1, 2, 3, 4].map((place) => ({ rating: 900, gamesPlayed: 0, place }));
    const changes = rateMultiplayer(players);
    // 1er : 3 victoires × 32/3 × 0,5 = 16 ; 2e : (1 − 2) × 32/3 × 0,5 ≈ 5 ; etc.
    expect(changes.map((c) => c.delta)).toEqual([16, 5, -5, -16]);
  });

  it('Ludo : même place = nulle entre eux', () => {
    const changes = rateMultiplayer([
      { rating: 900, gamesPlayed: 0, place: 1 },
      { rating: 900, gamesPlayed: 0, place: 1 },
    ]);
    expect(changes.map((c) => c.delta)).toEqual([0, 0]);
  });

  it('Ludo à 2 : identique à un duel', () => {
    const a = { rating: 1000, gamesPlayed: 10 };
    const b = { rating: 1200, gamesPlayed: 10 };
    const multi = rateMultiplayer([
      { ...a, place: 1 },
      { ...b, place: 2 },
    ]);
    const duel = rateDuel(a, b, 1);
    expect(multi[0]!.delta).toBe(duel.a.delta);
    expect(multi[1]!.delta).toBe(duel.b.delta);
  });

  it('refuse une partie à un seul joueur', () => {
    expect(() => rateMultiplayer([{ rating: 900, gamesPlayed: 0, place: 1 }])).toThrow();
  });

  it('variantes classées', () => {
    expect(isRatedVariant('dames10')).toBe(true);
    expect(isRatedVariant('ludo_six')).toBe(true);
    expect(isRatedVariant('ludo_parchis')).toBe(false);
  });
});
