import { boardFrom, fromPosition, initialState, legalMoves, type Move } from '@kwatt/rules-dames';
import { describe, expect, it } from 'vitest';
import { cellOf, cellSize, material, squareAt } from './geometry';
import { EMPTY_SELECTION, captureRequired, tap, targetsOf, threatened } from './selection';

describe('toucher le pion, puis la case', () => {
  it('sélectionne, propose les cases, joue', () => {
    const legal = legalMoves(initialState('dames10'));
    expect(tap(legal, EMPTY_SELECTION, 20).kind).toBe('invalid'); // pion noir : pas à toi
    const s = tap(legal, EMPTY_SELECTION, 32);
    expect(s).toEqual({ kind: 'select', selection: { from: 32, via: [] } });
    if (s.kind !== 'select') throw new Error();
    expect(targetsOf(legal, s.selection).sort()).toEqual([27, 28]);
    const played = tap(legal, s.selection, 28);
    expect(played.kind).toBe('play');
    if (played.kind === 'play') expect(played.move).toMatchObject({ from: 32, to: 28 });
    // Retoucher le pion le désélectionne ; toucher un autre pion le choisit.
    expect(tap(legal, s.selection, 32)).toEqual({ kind: 'select', selection: EMPTY_SELECTION });
    expect(tap(legal, s.selection, 31)).toEqual({ kind: 'select', selection: { from: 31, via: [] } });
  });

  it('prise obligatoire signalée, pièces menacées, rafle qui revient sur sa case', () => {
    // Le pion blanc en 28 fait le tour : 28x17x8x19x28 (quatre pions pris).
    const state = fromPosition('dames10', boardFrom('dames10', { w: [28], b: [22, 23, 12, 13] }), 'w');
    const legal = legalMoves(state);
    expect(captureRequired(legal)).toBe(true);
    const sel = tap(legal, EMPTY_SELECTION, 28);
    if (sel.kind !== 'select') throw new Error();
    expect(threatened(legal, sel.selection).sort()).toEqual([12, 13, 22, 23]);
    expect(targetsOf(legal, sel.selection)).toEqual([28]);
    expect(tap(legal, sel.selection, 28).kind).toBe('play');
  });

  it('deux rafles de même arrivée : on demande la case de passage', () => {
    const a: Move = { from: 1, to: 10, path: [1, 5, 10], captures: [3, 7] };
    const b: Move = { from: 1, to: 10, path: [1, 6, 10], captures: [4, 8] };
    const legal = [a, b];
    const s1 = tap(legal, EMPTY_SELECTION, 1);
    if (s1.kind !== 'select') throw new Error();
    const s2 = tap(legal, s1.selection, 10);
    expect(s2).toEqual({ kind: 'select', selection: { from: 1, via: [10] } });
    if (s2.kind !== 'select') throw new Error();
    expect(targetsOf(legal, s2.selection).sort()).toEqual([5, 6]);
    const s3 = tap(legal, s2.selection, 6);
    expect(s3.kind === 'play' && s3.move).toBe(b);
  });
});

describe('géométrie', () => {
  it('retourne le damier pour les noirs', () => {
    expect(cellOf('dames10', 1, false)).toEqual({ row: 0, col: 1 });
    expect(cellOf('dames10', 1, true)).toEqual({ row: 9, col: 8 });
    expect(squareAt('dames10', 9, 8, true)).toBe(1);
    expect(squareAt('dames8', 0, 0, false)).toBeNull();
  });

  it('cases d’au moins 34 px et compte des pièces', () => {
    expect(cellSize('dames10', 358)).toBe(34);
    expect(cellSize('dames10', 200)).toBe(34);
    expect(cellSize('dames8', 400)).toBe(48);
    expect(material(initialState('dames8').board, 'w')).toEqual({ men: 12, kings: 0 });
  });
});
