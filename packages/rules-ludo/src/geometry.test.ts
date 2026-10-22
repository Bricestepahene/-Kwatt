import { describe, expect, it } from 'vitest';
import {
  absoluteSquare,
  BASE,
  boardGeometry,
  finish,
  isSafeSquare,
  newGame,
  protectedSquares,
  startSquare,
  tokenPoint,
  TOPOLOGY,
  type BoardShape,
  type Config,
  type Point,
} from './index.js';

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const configs: Record<BoardShape, Config> = {
  croix: newGame({ preset: 'classique', players: 4 }).config,
  etoile: newGame({ preset: 'six', players: 6 }).config,
  parchis: newGame({ preset: 'parchis', players: 4 }).config,
  pachisi: newGame({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] }).config,
};
const BOARDS = Object.keys(configs) as BoardShape[];

describe.each(BOARDS)('géométrie : %s', (board) => {
  const g = boardGeometry(board);
  const config = configs[board];
  const t = TOPOLOGY[board];

  it('une case par case absolue, toutes dans le plateau, jamais superposées', () => {
    expect(g.track).toHaveLength(t.trackLength);
    const cells = [...g.track, ...g.corridors.flat()];
    for (const c of cells) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.y).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(g.size);
      expect(c.y).toBeLessThan(g.size);
    }
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) expect(dist(cells[i]!, cells[j]!)).toBeGreaterThan(0.99);
  });

  it('la piste se suit de proche en proche (voisines, ou en diagonale dans les angles)', () => {
    for (let s = 0; s < t.trackLength; s++) {
      const d = dist(g.track[s]!, g.track[(s + 1) % t.trackLength]!);
      expect(d).toBeGreaterThan(0.99);
      expect(d).toBeLessThan(1.5);
    }
  });

  it('chaque chemin suit les règles : piste = case absolue, couloir, arrivée', () => {
    for (let h = 0; h < t.homes; h++) {
      const path = g.paths[h]!;
      expect(path).toHaveLength(finish(config) + 1);
      for (let p = 0; p <= finish(config); p++) {
        const sq = absoluteSquare(config, h, p);
        if (sq !== null) expect(path[p]).toEqual(g.track[sq]);
      }
      // Pas à pas, du départ jusqu'à la dernière case du couloir.
      for (let p = 0; p < finish(config) - 1; p++) expect(dist(path[p]!, path[p + 1]!)).toBeLessThan(1.5);
      expect(path[finish(config)]).toMatchObject(g.goals[h]!);
      expect(dist(g.goals[h]!, g.center)).toBeLessThan(2);
      expect(g.starts[h]).toBe(startSquare(config, h));
      expect(g.entries[h]).toBe(absoluteSquare(config, h, t.lastTrack));
    }
  });

  it('cases protégées : les mêmes que les règles', () => {
    expect(g.safe[config.mechanics.safeSquares]).toEqual(protectedSquares(config));
    for (const sq of g.starts) expect(isSafeSquare(config, sq)).toBe(true);
  });

  it('bases : 4 emplacements dans la zone de la maison, pions placés par tokenPoint', () => {
    for (let h = 0; h < t.homes; h++) {
      const area = g.homeAreas[h]!;
      for (const s of g.baseSlots[h]!) {
        if (area.kind === 'rect') {
          expect(s.x).toBeGreaterThan(area.x);
          expect(s.x).toBeLessThan(area.x + area.w);
          expect(s.y).toBeGreaterThan(area.y);
          expect(s.y).toBeLessThan(area.y + area.h);
        } else {
          expect(dist(s, { x: area.cx, y: area.cy })).toBeLessThan(area.r);
        }
      }
      expect(tokenPoint(g, h, BASE, 2)).toEqual(g.baseSlots[h]![2]);
      expect(tokenPoint(g, h, 0, 0)).toEqual(g.paths[h]![0]);
    }
  });
});

describe('croix 15 × 15 : conforme à la planche 21', () => {
  const g = boardGeometry('croix');
  const grid = (p: Point): [number, number] => [Math.floor(p.y), Math.floor(p.x)];

  it('départs, étoiles, couloirs et maisons aux cases de la planche', () => {
    // [rangée, colonne] : rouge (6,1), vert (1,8), jaune (8,13), bleu (13,6).
    expect(g.starts.map((s) => grid(g.track[s]!))).toEqual([
      [6, 1],
      [1, 8],
      [8, 13],
      [13, 6],
    ]);
    expect(g.stars.map((s) => grid(g.track[s]!))).toEqual([
      [2, 6],
      [6, 12],
      [12, 8],
      [8, 2],
    ]);
    expect(g.corridors[0]!.map(grid)).toEqual([1, 2, 3, 4, 5].map((c) => [7, c]));
    expect(g.corridors[1]!.map(grid)).toEqual([1, 2, 3, 4, 5].map((r) => [r, 7]));
    expect(g.homeAreas).toEqual([
      { kind: 'rect', x: 0, y: 0, w: 6, h: 6 },
      { kind: 'rect', x: 9, y: 0, w: 6, h: 6 },
      { kind: 'rect', x: 9, y: 9, w: 6, h: 6 },
      { kind: 'rect', x: 0, y: 9, w: 6, h: 6 },
    ]);
    // Toutes les cases de piste sont hors des maisons et du centre 3 × 3.
    for (const c of g.track) {
      const [r, col] = grid(c);
      expect((r >= 6 && r <= 8) || (col >= 6 && col <= 8)).toBe(true);
      expect(r >= 6 && r <= 8 && col >= 6 && col <= 8).toBe(false);
    }
  });
});

describe('Parchís et Pachisi : croix 19 × 19', () => {
  it('Parchís : la sortie est à côté de sa maison, l’entrée du couloir au bout de sa branche', () => {
    const g = boardGeometry('parchis');
    for (let h = 0; h < 4; h++) {
      const area = g.homeAreas[h]!;
      if (area.kind !== 'rect') throw new Error('rect attendu');
      const exit = g.track[g.starts[h]!]!;
      const cx = Math.min(Math.max(exit.x, area.x), area.x + area.w);
      const cy = Math.min(Math.max(exit.y, area.y), area.y + area.h);
      expect(Math.hypot(exit.x - cx, exit.y - cy)).toBeLessThanOrEqual(0.5);
      // L'entrée (bout de branche) est au bord du plateau.
      const entry = g.track[g.entries[h]!]!;
      expect(Math.min(entry.x, entry.y, g.size - entry.x, g.size - entry.y)).toBe(0.5);
    }
  });

  it('Pachisi : la descente et la remontée empruntent la même colonne du milieu', () => {
    const g = boardGeometry('pachisi');
    for (let h = 0; h < 4; h++) {
      expect(g.lanes[h]).toHaveLength(7);
      expect([...g.lanes[h]!].reverse()).toEqual(g.corridors[h]);
      // La descente part du centre.
      expect(dist(g.lanes[h]![0]!, g.center)).toBeLessThan(2.2);
    }
    // Châteaux symétriques dans chaque branche : 3 par branche.
    expect(g.castles).toHaveLength(12);
  });
});

describe('étoile : 6 branches tournées de 60°', () => {
  it('cases tournées et symétrie de rotation', () => {
    const g = boardGeometry('etoile');
    expect(g.armAngles).toEqual([0, 60, 120, 180, 240, 300]);
    const c = g.center;
    for (let s = 0; s < 13; s++) {
      for (let k = 1; k < 6; k++) {
        const a = g.track[s]!;
        const b = g.track[s + 13 * k]!;
        expect(dist(a, c)).toBeCloseTo(dist(b, c), 4);
        expect((b.angle - a.angle + 360) % 360).toBe(60 * k);
      }
    }
  });
});
