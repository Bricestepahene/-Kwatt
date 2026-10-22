import { describe, expect, it } from 'vitest';
import { applyMove, boardFrom, fromPosition, initialState, legalMoves, moveKey, type DamesState, type Piece, type Variant } from '@kwatt/rules-dames';
import { Position, emoveKey, emoveNotation, geometry, initialPosition } from './core.js';
import { mulberry32 } from './random.js';

const keysOf = (moves: { from: number; to: number; captures?: number[]; caps?: number[] }[]): string[] => moves.map((m) => emoveKey(m)).sort();

/** Damier aléatoire avec des dames (pour éprouver les rafles des dames volantes). */
function randomBoard(variant: Variant, random: () => number): Piece[] {
  const g = geometry(variant);
  const board: Piece[] = Array.from({ length: g.n }, () => '' as Piece);
  const count = 3 + Math.floor(random() * (g.n * 0.5));
  for (let i = 0; i < count; i++) {
    const s = 1 + Math.floor(random() * g.n);
    const r = g.row[s]!;
    const roll = random();
    let p: Piece = roll < 0.35 ? 'w' : roll < 0.7 ? 'b' : roll < 0.85 ? 'W' : 'B';
    // Pas de pion sur sa ligne de promotion.
    if (p === 'w' && r === g.promoRow[0]) p = 'W';
    if (p === 'b' && r === g.promoRow[1]) p = 'B';
    board[s - 1] = p;
  }
  return board;
}

function compare(state: DamesState): void {
  const pos = Position.fromState(state);
  const ours = keysOf(pos.legalMoves());
  const theirs = keysOf(legalMoves({ ...state, result: null }));
  expect(ours).toEqual(theirs);
}

describe('générateur de coups (identique à @kwatt/rules-dames)', () => {
  for (const variant of ['dames10', 'dames8'] as const) {
    it(`${variant} : parties aléatoires, mêmes coups légaux à chaque position`, () => {
      const random = mulberry32(variant === 'dames10' ? 42 : 43);
      let positions = 0;
      for (let game = 0; game < 40; game++) {
        let state = initialState(variant);
        for (let ply = 0; ply < 160 && !state.result; ply++) {
          compare(state);
          positions++;
          const moves = legalMoves(state);
          const m = moves[Math.floor(random() * moves.length)]!;
          state = applyMove(state, m);
        }
      }
      expect(positions).toBeGreaterThan(2000);
    });

    it(`${variant} : positions aléatoires avec dames`, () => {
      const random = mulberry32(variant === 'dames10' ? 7 : 8);
      for (let i = 0; i < 1500; i++) {
        const board = randomBoard(variant, random);
        compare(fromPosition(variant, board, random() < 0.5 ? 'w' : 'b'));
      }
    });
  }

  it('joue et défait un coup sans rien perdre ; le hachage incrémental est exact', () => {
    const random = mulberry32(99);
    for (const variant of ['dames10', 'dames8'] as const) {
      const pos = initialPosition(variant);
      expect(pos.toBoard()).toEqual(initialState(variant).board);
      const trail: { board: string; h1: number; h2: number; quiet: number }[] = [];
      for (let ply = 0; ply < 120; ply++) {
        const moves = pos.legalMoves();
        if (moves.length === 0) break;
        trail.push({ board: Array.from(pos.b).join(','), h1: pos.h1, h2: pos.h2, quiet: pos.quiet });
        pos.make(moves[Math.floor(random() * moves.length)]!);
        const copy = pos.clone();
        copy.recount();
        expect([copy.h1, copy.h2]).toEqual([pos.h1, pos.h2]);
        expect(copy.wm + copy.wk + copy.bm + copy.bk).toBe(pos.wm + pos.wk + pos.bm + pos.bk);
      }
      while (trail.length) {
        pos.unmake();
        const t = trail.pop()!;
        expect({ board: Array.from(pos.b).join(','), h1: pos.h1, h2: pos.h2, quiet: pos.quiet }).toEqual(t);
      }
    }
  });

  it('prise majoritaire du problème du jour (écran 19b) : seul 32x3 est permis', () => {
    // Coordonnées de la planche : blancs 32, 35, 37, 43 ; noirs 1, 8, 14, 18, 28, 30.
    const board = boardFrom('dames10', { w: [32, 35, 37, 43], b: [1, 8, 14, 18, 28, 30] });
    const state = fromPosition('dames10', board, 'w');
    const pos = Position.fromState(state);
    const moves = pos.legalMoves();
    expect(keysOf(moves)).toEqual(keysOf(legalMoves(state)));
    expect(moves).toHaveLength(1);
    expect(emoveNotation(moves[0]!)).toBe('32x23x12x3');
    expect([...moves[0]!.caps].sort((a, b) => a - b)).toEqual([8, 18, 28]);
  });

  it('notation et clé de coup identiques à rules-dames', () => {
    const state = initialState('dames10');
    const pos = Position.fromState(state);
    const m = pos.legalMoves().find((x) => x.from === 32 && x.to === 28)!;
    expect(emoveNotation(m)).toBe('32-28');
    expect(emoveKey(m)).toBe(moveKey({ from: 32, to: 28, path: [32, 28], captures: [] }));
  });

  it('répétition : retour à une position déjà vue depuis le dernier coup irréversible', () => {
    const state = fromPosition('dames10', boardFrom('dames10', { W: [47], B: [4] }), 'w');
    const pos = Position.fromState(state);
    const go = (from: number, to: number): void => {
      const m = pos.legalMoves().find((x) => x.from === from && x.to === to);
      if (!m) throw new Error(`${from}-${to}`);
      pos.make(m);
    };
    go(47, 42);
    expect(pos.isRepetition()).toBe(false);
    go(4, 10);
    go(42, 47);
    go(10, 4);
    expect(pos.isRepetition()).toBe(true);
    expect(pos.quiet).toBe(4);
  });

  it('les positions déjà vues de la partie comptent pour la répétition', () => {
    let state = fromPosition('dames10', boardFrom('dames10', { W: [47], B: [4] }), 'w');
    state = applyMove(state, { from: 47, to: 42 });
    state = applyMove(state, { from: 4, to: 10 });
    const pos = Position.fromState(state);
    const back = pos.legalMoves().find((m) => m.from === 42 && m.to === 47)!;
    pos.make(back);
    const again = pos.legalMoves().find((m) => m.from === 10 && m.to === 4)!;
    pos.make(again);
    expect(pos.isRepetition()).toBe(true);
  });
});
