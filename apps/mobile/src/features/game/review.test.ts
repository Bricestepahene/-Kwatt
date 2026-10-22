import { describe, expect, it } from 'vitest';
import { firstSide, fullMoves, moveNumberOf, notationLine, progressOf } from './review';

describe('revoir une partie', () => {
  const moves = ['32-28', '19-23', '28x19', '14x23', '37-32'];

  it('notation par paire de coups', () => {
    expect(notationLine(moves, 0)).toBe('1. 32-28 · 19-23');
    expect(notationLine(moves, 1)).toBe('1. 32-28 · 19-23');
    expect(notationLine(moves, 3)).toBe('2. 28x19 · 14x23');
    expect(notationLine(moves, 4)).toBe('3. 37-32');
    expect(notationLine(moves, 99)).toBe('3. 37-32');
    expect(notationLine([], 0)).toBe('');
  });

  it('numéros de coup, progression, camp qui commence', () => {
    expect(moveNumberOf(0)).toBe(1);
    expect(moveNumberOf(43)).toBe(22);
    expect(fullMoves(92)).toBe(46);
    expect(progressOf(46, 92)).toBe(0.5);
    expect(progressOf(1, 0)).toBe(0);
    expect(firstSide('dames8')).toBe('b');
    expect(firstSide('dames10')).toBe('w');
  });
});
