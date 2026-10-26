import type { DailyPuzzle } from '@kwatt/protocol';
import { legalMoves, parseNotation, toNotation } from '@kwatt/rules-dames';
import { describe, expect, it } from 'vitest';
import { forcedReply, hintSquare, playerMove, playerToMove, startProgress } from './puzzle';

// Problème d10-002 du moteur : les blancs prennent 26x17x6 (deux pions).
const puzzle: DailyPuzzle = {
  id: 'd10-002',
  variant: 'dames10',
  side: 'w',
  white: { men: [26, 32, 35, 36, 37, 40, 45, 46, 48, 50], kings: [] },
  black: { men: [4, 5, 7, 11, 15, 16, 19, 21, 24, 25, 28], kings: [] },
  solution: ['26x17x6'],
  difficulty: 1,
  theme: 'capture_choice',
};

describe('problème du jour sur le plateau', () => {
  it('le bon coup résout le problème', () => {
    let g = startProgress(puzzle);
    expect(playerToMove(puzzle, g)).toBe(true);
    expect(hintSquare(puzzle, g)).toBe(26);
    const move = parseNotation(g.state, '26x17x6')!;
    g = playerMove(puzzle, g, move);
    expect(g.status).toBe('solved');
    expect(g.played).toEqual(['26x17x6']);
  });

  it('un autre coup est faux et indique le coup attendu', () => {
    const g0 = startProgress(puzzle);
    const other = legalMoves(g0.state).find((m) => toNotation(m) !== '26x17x6');
    if (!other) return; // une seule prise possible : rien à tester
    const g = playerMove(puzzle, g0, other);
    expect(g.status).toBe('wrong');
    expect(g.expected).toBe('26x17x6');
  });

  it('une suite à plusieurs coups joue la réponse forcée', () => {
    // Suite fictive : le premier coup, puis une réponse noire légale quelconque, puis un coup blanc légal.
    let g = startProgress(puzzle);
    const first = parseNotation(g.state, '26x17x6')!;
    const after = playerMove({ ...puzzle, solution: ['26x17x6', 'x', 'y'] }, g, first);
    const reply = toNotation(legalMoves(after.state)[0]!);
    const long: DailyPuzzle = { ...puzzle, solution: ['26x17x6', reply, 'z'] };
    g = playerMove(long, g, first);
    expect(g.status).toBe('playing');
    expect(playerToMove(long, g)).toBe(false);
    g = forcedReply(long, g);
    expect(g.step).toBe(2);
    expect(g.line).toEqual(['26x17x6', reply]);
    expect(playerToMove(long, g)).toBe(true);
  });
});
