import { BASE, newGame, type LudoState } from '@kwatt/rules-ludo';
import { describe, expect, it } from 'vitest';
import { fastRisk, reachMap } from './position.js';
import { threatsTo } from './threats.js';

const B = BASE;

function position(state: LudoState, tokens: number[][], current = 0): LudoState {
  return { ...state, tokens, current, phase: 'roll', roll: null, sixesInRow: 0, bonus: [], extraRoll: false, lastMoved: null };
}

/** Classique à 2 : le siège 1 est en maison 2 ; sa progression pour une case absolue. */
const p2 = (square: number): number => (square - 26 + 52) % 52;

describe('probabilité exacte d’être pris au prochain tour', () => {
  it('adversaire 3 cases derrière : 3 tout de suite, ou 6 (sortie) puis 3, ou 6, 6 puis 3', () => {
    const g = position(newGame({ preset: 'classique', players: 2 }), [[10, B, B, B], [p2(7), B, B, B]]);
    const t = threatsTo(g, 0);
    expect(t.perToken[0]![0]).toBeCloseTo(43 / 216, 12);
    expect(t.any).toBeCloseTo(43 / 216, 12);
    expect(t.nodes).toBeGreaterThan(0);
  });

  it('8 cases derrière : seulement par 6 puis 2 (le même pion), ou 6, 6 puis… jamais avec le troisième 6', () => {
    const g = position(newGame({ preset: 'classique', players: 2 }), [[10, B, B, B], [p2(2), B, B, B]]);
    // 6 puis 2 : 1/36 ; 6 (sortie), 6 puis 2 : 1/216 ; 6, 6 (sortie) … : déjà compté.
    expect(threatsTo(g, 0).perToken[0]![0]).toBeCloseTo(1 / 36 + 1 / 216, 12);
  });

  it('case protégée, base, couloir : aucun risque', () => {
    // Case 8 = étoile ; pion au couloir (52) ; pion à la base.
    const g = position(newGame({ preset: 'classique', players: 2 }), [[8, 52, B, B], [p2(5), B, B, B]]);
    const t = threatsTo(g, 0);
    expect(t.perToken[0]).toEqual([0, 0, 0, 0]);
    expect(t.any).toBe(0);
  });

  it('deux pions menacés : « au moins un » est plus probable que chacun', () => {
    const g = position(newGame({ preset: 'classique', players: 2 }), [[10, 12, B, B], [p2(7), B, B, B]]);
    const t = threatsTo(g, 0);
    expect(t.any).toBeGreaterThan(Math.max(t.perToken[0]![0]!, t.perToken[0]![1]!));
    expect(t.any).toBeLessThanOrEqual(t.perToken[0]![0]! + t.perToken[0]![1]!);
  });

  it('un partenaire ne menace pas ; ses pions sont protégés aussi', () => {
    const base = newGame({ preset: 'classique', players: 4, teams: [[0, 2], [1, 3]] });
    // Siège 2 (maison 2), partenaire, 3 cases derrière le pion du siège 0.
    const g = position(base, [[10, B, B, B], [B, B, B, B], [p2(7), B, B, B], [B, B, B, B]]);
    expect(threatsTo(g, 0).perToken[0]![0]).toBe(0);
    // Le siège 1 (maison 1) menace le pion du partenaire (siège 2) en case 20, 2 cases devant lui.
    const h = position(base, [[B, B, B, B], [5, B, B, B], [p2(20), B, B, B], [B, B, B, B]]);
    expect(threatsTo(h, 0).perToken[2]![0]).toBeGreaterThan(0);
  });

  it('Parchís : une barrière arrête la menace', () => {
    const g = newGame({ preset: 'parchis', players: 2 });
    // Maison 0 : pion en case 10 (prog 5) ; maison 2 (siège 1) : pion en case 7 ; barrière de la maison 0 en case 9.
    const prog2 = (sq: number): number => (((sq - 5 - 34) % 68) + 68) % 68;
    const open = position(g, [[5, B, B, B], [prog2(7), B, B, B]]);
    const blocked = position(g, [[5, 4, 4, B], [prog2(7), B, B, B]]);
    expect(threatsTo(open, 0).perToken[0]![0]).toBeGreaterThan(0.15);
    expect(threatsTo(blocked, 0).perToken[0]![0]).toBe(0);
  });

  it('Pachisi : loi des cauris (un 10 qui prend, des grâces qui relancent)', () => {
    const g = newGame({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] });
    // Siège 0 (maison 0) en case 12 (prog 19) ; siège 1 (maison 1) 10 cases derrière, en case 2 (prog 2 − 17 + 68 + 7 = 60).
    const t = threatsTo(position(g, [[19, B, B, B], [60, B, B, B], [B, B, B, B], [B, B, B, B]]), 0);
    // Au moins la probabilité d'un 10 direct (6/64).
    expect(t.perToken[0]![0]).toBeGreaterThanOrEqual(6 / 64 - 1e-12);
    expect(t.perToken[0]![0]).toBeLessThan(0.2);
  });
});

describe('estimation rapide des menaces', () => {
  it('proche de l’exact sans barrière', () => {
    const g = position(newGame({ preset: 'classique', players: 2 }), [[10, B, B, B], [p2(7), B, B, B]]);
    const fast = fastRisk(g, reachMap(g), 0, 10);
    // Direct (1/6) ; la sortie suivie d'un lancer ne vise que les cases proches du départ adverse.
    expect(fast).toBeCloseTo(1 / 6, 6);
    expect(fastRisk(g, reachMap(g), 0, 8)).toBe(0);
  });
});
