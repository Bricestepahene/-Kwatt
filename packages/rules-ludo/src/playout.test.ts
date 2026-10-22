import { describe, expect, it } from 'vitest';
import {
  absoluteSquare,
  applyMove,
  applyRoll,
  arePartners,
  BASE,
  finish,
  isCastle,
  legalMoves,
  newGame,
  teamRanking,
  throwDistribution,
  type LudoState,
  type NewGameOptions,
} from './index.js';

/** mulberry32 : générateur de test, jamais utilisé pour de vraies parties. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lancer selon la loi exacte de la variante (dé ou cauris). */
function thrower(state: LudoState, next: () => number): () => number {
  const dist = throwDistribution(state.config.mechanics.throw);
  return () => {
    let u = next();
    for (const { value, p } of dist) {
      if (u < p) return value;
      u -= p;
    }
    return dist[dist.length - 1]!.value;
  };
}

/** Invariants vérifiés après chaque lancer et chaque coup. */
function checkInvariants(g: LudoState): void {
  const end = finish(g.config);
  const perSquare = new Map<number, number[]>();
  g.tokens.forEach((list, seat) => {
    const s = g.seats[seat]!;
    for (const p of list) {
      expect(p === BASE || (p >= 0 && p <= end)).toBe(true);
      const sq = s.status === 'out' ? null : absoluteSquare(g.config, s.home, p);
      if (sq !== null) perSquare.set(sq, [...(perSquare.get(sq) ?? []), seat]);
    }
    if (s.status === 'finished') expect(list.every((p) => p === end)).toBe(true);
  });
  const b = g.config.mechanics.barriers;
  for (const [sq, seats] of perSquare) {
    if (b === 'any' || b === 'six_opens' || (b === 'castles' && isCastle(g.config, sq))) expect(seats.length).toBeLessThanOrEqual(2);
  }
  expect(new Set(g.ranking).size).toBe(g.ranking.length);
  if (g.phase === 'move') expect(legalMoves(g).length).toBeGreaterThan(0);
  // Le Pachisi : jamais un pion à une case de l'arrivée.
  if (g.config.mechanics.throw === 'cowries') for (const list of g.tokens) expect(list.includes(end - 1)).toBe(false);
}

/** Aucune barrière n'est traversée, et on ne prend jamais un partenaire. */
function checkMove(g: LudoState, m: ReturnType<typeof legalMoves>[number]): void {
  for (const c of m.captures) expect(arePartners(g, m.seat, c.seat)).toBe(false);
  if (m.from === BASE || g.config.mechanics.barriers === 'none') return;
  const home = g.seats[m.seat]!.home;
  for (let p = m.from + 1; p <= m.to; p++) {
    const sq = absoluteSquare(g.config, home, p);
    if (sq === null) continue;
    if (g.config.mechanics.barriers === 'castles' && !isCastle(g.config, sq)) continue;
    const counts = new Map<number, number>();
    g.tokens.forEach((list, seat) => {
      if (g.seats[seat]!.status === 'out') return;
      for (const q of list) if (absoluteSquare(g.config, g.seats[seat]!.home, q) === sq) counts.set(seat, (counts.get(seat) ?? 0) + 1);
    });
    expect([...counts.values()].some((c) => c >= 2)).toBe(false);
  }
}

function playout(options: NewGameOptions, seed: number, check = true): { game: LudoState; steps: number } {
  const next = rng(seed);
  let g = newGame(options);
  const roll = thrower(g, next);
  let steps = 0;
  while (g.phase !== 'over' && steps++ < 50_000) {
    if (g.phase === 'roll') g = applyRoll(g, roll());
    else {
      const moves = legalMoves(g);
      const m = moves[Math.floor(next() * moves.length)]!;
      if (check) checkMove(g, m);
      g = applyMove(g, m);
    }
    if (check) checkInvariants(g);
  }
  return { game: g, steps };
}

const CASES: [string, NewGameOptions][] = [
  ['classique à 2', { preset: 'classique', players: 2 }],
  ['classique à 4 en équipes', { preset: 'classique', players: 4, teams: [[0, 2], [1, 3]] }],
  ['rapide à 4', { preset: 'rapide', players: 4 }],
  ['6 joueurs, 3 × 2', { preset: 'six', players: 6, teams: [[0, 3], [1, 4], [2, 5]] }],
  ['6 joueurs, 2 × 3', { preset: 'six', players: 6, teams: [[0, 2, 4], [1, 3, 5]] }],
  ['Parchís à 2', { preset: 'parchis', players: 2 }],
  ['Parchís à 3', { preset: 'parchis', players: 3 }],
  ['Parchís à 4', { preset: 'parchis', players: 4 }],
  ['Parchís 2 contre 2', { preset: 'parchis', players: 4, teams: [[0, 2], [1, 3]] }],
  ['Pachisi', { preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] }],
  ['maison : croix, barrières, + 20', { preset: 'classique', players: 4, house: { barriers: 'six_opens', capture: 'home_bonus20', exit: 'five' } }],
  ['maison : croix, barrières libres, sortie 6 ou 1', { preset: 'classique', players: 3, house: { barriers: 'any', exit: 'six_or_one', protection: 'departs' } }],
  ['maison : étoile, barrières', { preset: 'six', players: 5, house: { barriers: 'six_opens' } }],
  ['maison : Parchís sans barrières', { preset: 'parchis', players: 4, house: { barriers: 'none', capture: 'home_roll_again' } }],
  ['maison : Pachisi sans barrières, protection aux bouts de branche', { preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]], house: { barriers: 'none', protection: 'departs', capture: 'home_bonus20' } }],
];

describe('parties complètes au hasard : invariants à chaque pas', () => {
  it.each(CASES)('%s', (_name, options) => {
    for (let seed = 1; seed <= 3; seed++) {
      const { game } = playout(options, seed);
      expect(game.phase).toBe('over');
      expect([...game.ranking].sort((a, b) => a - b)).toEqual(Array.from({ length: options.players }, (_, i) => i));
      if (options.teams) expect(teamRanking(game)).toHaveLength(options.teams.length);
    }
  });

  it('même graine, même partie (toutes variantes)', () => {
    for (const [, options] of CASES) expect(playout(options, 42, false).game).toEqual(playout(options, 42, false).game);
  });

  it('les parties se terminent en un nombre de pas raisonnable', () => {
    for (const [, options] of CASES) {
      const lengths = [11, 12, 13].map((seed) => playout(options, seed, false).steps);
      for (const n of lengths) expect(n).toBeLessThan(20_000);
    }
  });
});
