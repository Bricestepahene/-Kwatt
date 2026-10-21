import { describe, expect, it } from 'vitest';
import {
  applyMove,
  boardFrom,
  fromPosition,
  GEOMETRY_10,
  GEOMETRY_8,
  IllegalMoveError,
  initialState,
  legalMoves,
  parseNotation,
  toCoord,
  toNotation,
  toSquare,
  type DamesState,
  type Move,
} from './index.js';

const sq10 = (r: number, c: number): number => toSquare(GEOMETRY_10, r, c)!;
const sq8 = (r: number, c: number): number => toSquare(GEOMETRY_8, r, c)!;

function play(state: DamesState, ...notations: string[]): DamesState {
  let s = state;
  for (const n of notations) {
    const m = parseNotation(s, n);
    if (!m) throw new Error(`coup introuvable : ${n}`);
    s = applyMove(s, m);
  }
  return s;
}

describe('numérotation', () => {
  it('suit la notation officielle 1–50', () => {
    expect(sq10(0, 1)).toBe(1);
    expect(sq10(0, 9)).toBe(5);
    expect(sq10(1, 0)).toBe(6);
    expect(sq10(6, 1)).toBe(31);
    expect(sq10(9, 8)).toBe(50);
    expect(toSquare(GEOMETRY_10, 0, 0)).toBeNull();
    for (let s = 1; s <= 50; s++) {
      const { row, col } = toCoord(GEOMETRY_10, s);
      expect(toSquare(GEOMETRY_10, row, col)).toBe(s);
    }
  });
  it('suit la notation 1–32 en 8×8', () => {
    expect(sq8(0, 1)).toBe(1);
    expect(sq8(7, 6)).toBe(32);
  });
});

describe('dames 10×10 internationales', () => {
  it('position initiale : 20 pions chacun, les blancs ont 9 coups', () => {
    const s = initialState('dames10');
    expect(s.board.filter((p) => p === 'b')).toHaveLength(20);
    expect(s.board.filter((p) => p === 'w')).toHaveLength(20);
    expect(s.turn).toBe('w');
    expect(legalMoves(s)).toHaveLength(9);
  });

  it('un coup se note et se rejoue', () => {
    const s = play(initialState('dames10'), '32-28', '19-23', '28x19', '14x23');
    expect(s.ply).toBe(4);
    expect(s.board.filter((p) => p === 'w')).toHaveLength(19);
    expect(s.board.filter((p) => p === 'b')).toHaveLength(19);
  });

  it('la prise est obligatoire', () => {
    const s = play(initialState('dames10'), '32-28', '19-23');
    const moves = legalMoves(s);
    expect(moves).toHaveLength(1);
    expect(toNotation(moves[0]!)).toBe('28x19');
    expect(() => applyMove(s, { from: 31, to: 27 })).toThrow(IllegalMoveError);
  });

  it('la prise majoritaire est imposée', () => {
    const board = boardFrom('dames10', { w: [sq10(6, 3)], b: [sq10(5, 2), sq10(5, 4), sq10(3, 6)] });
    const moves = legalMoves(fromPosition('dames10', board, 'w'));
    expect(moves).toHaveLength(1);
    expect(moves[0]!.captures).toHaveLength(2);
    expect(moves[0]!.to).toBe(sq10(2, 7));
  });

  it('un pion prend aussi en arrière', () => {
    const board = boardFrom('dames10', { w: [sq10(4, 3)], b: [sq10(5, 4)] });
    const moves = legalMoves(fromPosition('dames10', board, 'w'));
    expect(moves.map(toNotation)).toEqual([`${sq10(4, 3)}x${sq10(6, 5)}`]);
  });

  it('la dame volante prend à distance et choisit sa case d’arrivée', () => {
    const board = boardFrom('dames10', { W: [sq10(9, 0)], b: [sq10(5, 4)] });
    const moves = legalMoves(fromPosition('dames10', board, 'w'));
    expect(moves.map((m) => m.to).sort((a, b) => a - b)).toEqual(
      [sq10(4, 5), sq10(3, 6), sq10(2, 7), sq10(1, 8), sq10(0, 9)].sort((a, b) => a - b),
    );
  });

  it('la dame volante se déplace de plusieurs cases', () => {
    const board = boardFrom('dames10', { W: [sq10(9, 0)], b: [sq10(0, 1)] });
    expect(legalMoves(fromPosition('dames10', board, 'w'))).toHaveLength(9);
  });

  it('une pièce n’est jamais prise deux fois dans une rafle', () => {
    const board = boardFrom('dames10', {
      W: [sq10(7, 2)],
      b: [sq10(6, 3), sq10(3, 4), sq10(3, 2)],
    });
    const s = fromPosition('dames10', board, 'w');
    for (const m of legalMoves(s)) {
      expect(new Set(m.captures).size).toBe(m.captures.length);
    }
  });

  it('un pion qui traverse la dernière rangée pendant une rafle reste pion', () => {
    const board = boardFrom('dames10', { w: [sq10(2, 1)], b: [sq10(1, 2), sq10(1, 4)] });
    const s = fromPosition('dames10', board, 'w');
    const moves = legalMoves(s);
    expect(moves).toHaveLength(1);
    const next = applyMove(s, moves[0]!);
    expect(next.board[sq10(2, 5) - 1]).toBe('w');
  });

  it('un pion qui finit sur la dernière rangée devient dame', () => {
    const board = boardFrom('dames10', { w: [sq10(1, 2)], b: [sq10(9, 0)] });
    const next = applyMove(fromPosition('dames10', board, 'w'), { from: sq10(1, 2), to: sq10(0, 1) });
    expect(next.board[sq10(0, 1) - 1]).toBe('W');
  });

  it('sans coup possible, on perd', () => {
    const board = boardFrom('dames10', { w: [sq10(6, 3)], b: [sq10(5, 2)] });
    const next = applyMove(fromPosition('dames10', board, 'w'), { from: sq10(6, 3), to: sq10(4, 1) });
    expect(next.result).toEqual({ winner: 'w', reason: 'no_moves' });
  });

  it('même position 3 fois : nulle', () => {
    const W1 = sq10(9, 0), W2 = sq10(8, 1), B1 = sq10(0, 1), B2 = sq10(1, 0);
    let s = fromPosition('dames10', boardFrom('dames10', { W: [W1], B: [B1] }), 'w');
    for (let i = 0; i < 2; i++) {
      s = applyMove(s, { from: W1, to: W2 });
      s = applyMove(s, { from: B1, to: B2 });
      s = applyMove(s, { from: W2, to: W1 });
      if (i === 1) {
        expect(s.result).toBeNull();
      }
      s = applyMove(s, { from: B2, to: B1 });
    }
    expect(s.result).toEqual({ winner: null, reason: 'repetition' });
  });

  it('la règle des 25 coups se déclenche au 50e demi-coup de dames', () => {
    let s = fromPosition('dames10', boardFrom('dames10', { W: [sq10(9, 0)], B: [sq10(0, 9)] }), 'w');
    s = { ...s, quietKingPlies: 49, seen: {} };
    s = applyMove(s, { from: sq10(9, 0), to: sq10(8, 1) });
    expect(s.result).toEqual({ winner: null, reason: 'quiet_kings' });
  });

  it('parties aléatoires : invariants', () => {
    let seed = 42;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let g = 0; g < 20; g++) {
      let s = initialState('dames10');
      while (!s.result && s.ply < 300) {
        const moves = legalMoves(s);
        const m = moves[rnd(moves.length)]!;
        const before = s.board.filter((p) => p !== '').length;
        s = applyMove(s, m);
        expect(s.board.filter((p) => p !== '').length).toBe(before - m.captures.length);
      }
    }
  });
});

describe('dames 8×8 anglaises', () => {
  it('position initiale : 12 pions chacun, les noirs commencent avec 7 coups', () => {
    const s = initialState('dames8');
    expect(s.turn).toBe('b');
    expect(s.board.filter((p) => p === 'b')).toHaveLength(12);
    expect(legalMoves(s)).toHaveLength(7);
  });

  it('un pion ne prend pas en arrière', () => {
    const board = boardFrom('dames8', { w: [sq8(5, 2)], b: [sq8(6, 3), sq8(0, 7)] });
    const moves: Move[] = legalMoves(fromPosition('dames8', board, 'w'));
    expect(moves.every((m) => m.captures.length === 0)).toBe(true);
  });

  it('libre choix de la prise : pas de prise majoritaire', () => {
    const board = boardFrom('dames8', { w: [sq8(6, 3)], b: [sq8(5, 2), sq8(5, 4), sq8(3, 6)] });
    const counts = legalMoves(fromPosition('dames8', board, 'w')).map((m) => m.captures.length).sort();
    expect(counts).toEqual([1, 2]);
  });

  it('un pion promu pendant une rafle s’arrête', () => {
    const board = boardFrom('dames8', { w: [sq8(2, 1)], b: [sq8(1, 2), sq8(1, 4)] });
    const s = fromPosition('dames8', board, 'w');
    const moves = legalMoves(s);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.captures).toHaveLength(1);
    const next = applyMove(s, moves[0]!);
    expect(next.board[sq8(0, 3) - 1]).toBe('W');
  });

  it('la dame est courte', () => {
    const board = boardFrom('dames8', { W: [sq8(7, 0)], b: [sq8(0, 1)] });
    expect(legalMoves(fromPosition('dames8', board, 'w'))).toHaveLength(1);
  });
});
