import { describe, expect, it } from 'vitest';
import { boardFrom, fromPosition, initialState } from '@kwatt/rules-dames';
import { majorityQuiz } from './puzzles.js';

describe('quiz de la prise majoritaire (écran 19b)', () => {
  it('« Deux pions peuvent prendre » : 32x3 est permis, 35x24 est un piège', () => {
    const state = fromPosition('dames10', boardFrom('dames10', { w: [32, 35, 37, 43], b: [1, 8, 14, 18, 28, 30] }), 'w');
    expect(majorityQuiz(state)).toEqual({ legal: ['32x23x12x3'], decoys: ['35x24'] });
  });

  it('rien à demander sans prise, ou en 8×8 (libre choix de la prise)', () => {
    expect(majorityQuiz(initialState('dames10'))).toBeNull();
    const eight = fromPosition('dames8', boardFrom('dames8', { w: [22, 23], b: [18, 14, 9] }), 'w');
    expect(majorityQuiz(eight)).toBeNull();
  });
});
