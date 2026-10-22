import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { positionKey } from '@kwatt/rules-dames';
import { checkUniqueness, dailyPuzzle, isPuzzleFile, puzzleState, verifyPuzzle, type Puzzle, type PuzzleFile } from './puzzles.js';

const load = (name: string): PuzzleFile => {
  const data: unknown = JSON.parse(readFileSync(new URL(`../puzzles/${name}`, import.meta.url), 'utf8'));
  if (!isPuzzleFile(data)) throw new Error(`${name} : format invalide`);
  return data;
};

const files = { dames10: load('dames10.json'), dames8: load('dames8.json') };
const THEMES = ['shot', 'coup_de_dame', 'rafle', 'capture_choice', 'win_material'];

describe('problèmes du jour (écran 19b)', () => {
  it('au moins 120 problèmes 10×10 et quelques 8×8', () => {
    expect(files.dames10.puzzles.length).toBeGreaterThanOrEqual(120);
    expect(files.dames8.puzzles.length).toBeGreaterThanOrEqual(10);
  });

  for (const [variant, file] of Object.entries(files)) {
    it(`${variant} : identifiants et positions uniques, champs valides`, () => {
      expect(file.variant).toBe(variant);
      const ids = new Set<string>();
      const positions = new Set<string>();
      for (const p of file.puzzles) {
        expect(p.variant).toBe(variant);
        ids.add(p.id);
        const s = puzzleState(p);
        positions.add(positionKey(s.board, s.turn));
        expect(p.difficulty).toBeGreaterThanOrEqual(1);
        expect(p.difficulty).toBeLessThanOrEqual(5);
        expect(THEMES).toContain(p.theme);
        expect(p.gain).toBeGreaterThanOrEqual(2);
        expect(p.solution.length).toBeGreaterThanOrEqual(1);
      }
      expect(ids.size).toBe(file.puzzles.length);
      expect(positions.size).toBe(file.puzzles.length);
    });

    it(`${variant} : chaque solution est revérifiée (légale, réponses forcées, gain acquis, pas de reprise)`, () => {
      const failures: string[] = [];
      for (const p of file.puzzles) {
        const check = verifyPuzzle(p);
        if (!check.ok) failures.push(`${p.id} : ${check.errors.join(' ; ')}`);
      }
      expect(failures).toEqual([]);
    });

    it(`${variant} : le premier coup est le seul qui gagne (échantillon contrôlé par le moteur)`, () => {
      const sample = file.puzzles.filter((_, i) => i % 20 === 0);
      for (const p of sample) {
        const u = checkUniqueness(p, { maxNodes: 200_000 });
        expect({ id: p.id, ok: u.ok }).toEqual({ id: p.id, ok: true });
      }
    }, 120_000);
  }

  it('plusieurs thèmes et toutes les difficultés représentées en 10×10', () => {
    const themes = new Set(files.dames10.puzzles.map((p) => p.theme));
    expect(themes.size).toBeGreaterThanOrEqual(3);
    const levels = new Set(files.dames10.puzzles.map((p) => p.difficulty));
    expect(levels.size).toBeGreaterThanOrEqual(3);
  });

  it('un problème faux est refusé', () => {
    const p: Puzzle = files.dames10.puzzles[0]!;
    expect(verifyPuzzle({ ...p, gain: p.gain + 5 }).ok).toBe(false);
    expect(verifyPuzzle({ ...p, solution: ['1-2'] }).ok).toBe(false);
    expect(verifyPuzzle({ ...p, solution: [] }).ok).toBe(false);
  });

  it('problème du jour : le même pour tous un jour donné, chaque problème revient une fois par cycle', () => {
    const list = files.dames10.puzzles;
    expect(dailyPuzzle(list, 20_000)).toBe(dailyPuzzle(list, 20_000));
    const seen = new Set<string>();
    for (let d = 0; d < list.length; d++) seen.add(dailyPuzzle(list, 20_000 + d).id);
    expect(seen.size).toBe(list.length);
    expect(dailyPuzzle(list, 20_000).id).not.toBe(dailyPuzzle(list, 20_001).id);
    expect(() => dailyPuzzle([], 1)).toThrow();
  });
});
