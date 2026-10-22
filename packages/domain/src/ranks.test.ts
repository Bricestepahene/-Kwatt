import { describe, expect, it } from 'vitest';
import {
  RANKS,
  levelFromRating,
  levelProgress,
  lowestRank,
  pointsToNextLevel,
  rankAtLeast,
  rankForLevel,
  rankForRating,
  ratingForLevel,
  standingFor,
  unlocksUpTo,
} from './ranks.js';

describe('niveaux', () => {
  it('niveau = max(1, ⌊(force − 800) ÷ 40⌋) : Niv 17 à 1 482, Niv 18 à 1 520 (écran 09)', () => {
    expect(levelFromRating(1482)).toBe(17);
    expect(levelFromRating(1520)).toBe(18);
    expect(levelFromRating(1519)).toBe(17);
    expect(levelFromRating(900)).toBe(2);
    expect(levelFromRating(879)).toBe(1);
    expect(levelFromRating(500)).toBe(1);
  });

  it('« Encore 38 points de force pour Niv. 18 » à 1 482', () => {
    expect(pointsToNextLevel(1482)).toEqual({ nextLevel: 18, points: 38 });
    expect(pointsToNextLevel(1520)).toEqual({ nextLevel: 19, points: 40 });
    expect(pointsToNextLevel(700)).toEqual({ nextLevel: 2, points: 180 });
  });

  it('avancée dans le niveau (barre de progression)', () => {
    expect(levelProgress(1482)).toBeCloseTo(0.05, 10);
    expect(levelProgress(1519)).toBeCloseTo(39 / 40, 10);
    expect(levelProgress(1520)).toBe(0);
    expect(levelProgress(860)).toBe(0.5);
    expect(levelProgress(500)).toBe(0);
  });

  it('force minimale par niveau', () => {
    expect(ratingForLevel(18)).toBe(1520);
    expect(ratingForLevel(2)).toBe(880);
    expect(ratingForLevel(1)).toBe(-Infinity);
    expect(() => ratingForLevel(0)).toThrow();
    expect(() => ratingForLevel(2.5)).toThrow();
  });
});

describe('échelons (planche 41)', () => {
  it('bornes : Apprenti 1–4, Débrouillard 5–9, Ancien 10–14, Notable 15–19, Chef 20–24, Fon 25+', () => {
    const expected: [number, string][] = [
      [1, 'apprenti'], [4, 'apprenti'], [5, 'debrouillard'], [9, 'debrouillard'], [10, 'ancien'], [14, 'ancien'],
      [15, 'notable'], [19, 'notable'], [20, 'chef'], [24, 'chef'], [25, 'fon'], [60, 'fon'],
    ];
    for (const [level, id] of expected) expect(rankForLevel(level).id).toBe(id);
  });

  it('écran 14 : Notable · Niv 17 à 1 482', () => {
    expect(rankForRating(1482).id).toBe('notable');
    expect(standingFor(1482)).toEqual({ rating: 1482, level: 17, rank: 'notable', nextLevel: 18, pointsToNextLevel: 38 });
  });

  it('les échelons se suivent sans trou', () => {
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i]!.minLevel).toBe(RANKS[i - 1]!.maxLevel! + 1);
    expect(RANKS[RANKS.length - 1]!.maxLevel).toBeNull();
  });

  it('limites de table : 50 / 100 / 200 / 500 / 2 000 / 5 000 (SPEC §7, D-07)', () => {
    expect(RANKS.map((r) => r.tableLimit)).toEqual([50, 100, 200, 500, 2000, 5000]);
    expect(RANKS.map((r) => r.tableName)).toEqual([null, null, null, 'table_wouri', 'table_mont_cameroun', 'trone_du_fon']);
  });

  it('déblocages cumulés (planche Échelons, machine Fon à l’échelon Chef)', () => {
    expect(unlocksUpTo('apprenti')).toEqual(['unlock.basic_board']);
    expect(unlocksUpTo('ancien')).toContain('unlock.public_league_creation');
    expect(unlocksUpTo('notable')).not.toContain('unlock.machine_fon');
    expect(unlocksUpTo('chef')).toContain('unlock.machine_fon');
    expect(unlocksUpTo('fon')).toContain('unlock.legendary_frame');
  });

  it('comparaisons et échelon le plus bas', () => {
    expect(rankAtLeast('chef', 'ancien')).toBe(true);
    expect(rankAtLeast('debrouillard', 'ancien')).toBe(false);
    expect(lowestRank(['chef', 'notable', 'fon']).id).toBe('notable');
    expect(() => lowestRank([])).toThrow();
  });
});
