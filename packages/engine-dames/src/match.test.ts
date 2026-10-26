import { describe, expect, it } from 'vitest';
import { playMatch } from './match.js';

describe('mini-match de contrôle', () => {
  it('10×10 : l’Ancien du kwatt bat l’Apprenti', () => {
    const r = playMatch({ variant: 'dames10', ratingA: 1350, ratingB: 800, games: 2, maxPlies: 160 });
    expect(r.scoreA).toBeGreaterThan(r.scoreB);
    expect(r.scoreA).toBeGreaterThanOrEqual(1.5);
  }, 60_000);

  it('8×8 : le Débrouillard bat l’Apprenti', () => {
    const r = playMatch({ variant: 'dames8', ratingA: 1100, ratingB: 800, games: 2, maxPlies: 140 });
    expect(r.scoreA).toBeGreaterThan(r.scoreB);
  }, 60_000);
});
