import { describe, expect, it } from 'vitest';
import { applyMove, boardFrom, fromPosition, initialState, legalMoves, toNotation, type DamesState } from '@kwatt/rules-dames';
import { agreementRateSync, analyzeGame, analyzeGameSync, hintSync, qualityOf, replay } from './analysis.js';
import { mulberry32 } from './random.js';

describe('Revoir : analyse d’une partie (écran 19)', () => {
  it('qualité selon la perte : meilleur / bon / imprécision / erreur', () => {
    expect(qualityOf(0, false)).toBe('best');
    expect(qualityOf(200, true)).toBe('best');
    expect(qualityOf(30, false)).toBe('good');
    expect(qualityOf(70, false)).toBe('inaccuracy');
    expect(qualityOf(120, false)).toBe('mistake');
  });

  it('pion laissé en prise : erreur, moment clé avec la case', () => {
    // Blancs 32 et 46, noirs 22 et 3 : 32-28 et 32-27 laissent un pion en prise, 46-41 non.
    const start = fromPosition('dames10', boardFrom('dames10', { w: [32, 46], b: [3, 22] }), 'w');
    const a = analyzeGameSync('dames10', ['32-28', '22x33'], { start, depth: 6 });
    expect(a.moves).toHaveLength(2);
    const [blunder, reply] = a.moves;
    expect(blunder).toMatchObject({ ply: 0, moveNumber: 1, side: 'w', notation: '32-28', bestNotation: '46-41', quality: 'mistake', forced: false });
    expect(blunder!.loss).toBeGreaterThanOrEqual(90);
    expect(reply).toMatchObject({ side: 'b', notation: '22x33', forced: true, quality: 'best', captures: 1 });
    expect(a.keyMoments).toContainEqual(expect.objectContaining({ ply: 0, kind: 'piece_left_hanging', side: 'w', params: expect.objectContaining({ square: 28 }) }));
    expect(a.counts.w.mistake).toBe(1);
  });

  it('rafle de 3 pions et dame : moments clés (écran 19b)', () => {
    const start = fromPosition('dames10', boardFrom('dames10', { w: [32, 35, 37, 43], b: [1, 8, 14, 18, 28, 30] }), 'w');
    const a = analyzeGameSync('dames10', ['32x23x12x3'], { start, depth: 4 });
    expect(a.moves[0]).toMatchObject({ notation: '32x23x12x3', captures: 3, promotes: true, forced: true, quality: 'best' });
    expect(a.keyMoments).toEqual([
      { ply: 0, moveNumber: 1, side: 'w', kind: 'rafle', params: { count: 3 } },
      { ply: 0, moveNumber: 1, side: 'w', kind: 'promotion', params: { square: 3 } },
    ]);
  });

  it('numérotation officielle des coups et version asynchrone identique', async () => {
    const moves = ['32-28', '19-23', '28x19', '14x23', '37-32', '20-24'];
    const sync = analyzeGameSync('dames10', moves, { depth: 3 });
    expect(sync.moves.map((m) => m.moveNumber)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(sync.moves.map((m) => m.side)).toEqual(['w', 'b', 'w', 'b', 'w', 'b']);
    const asyncA = await analyzeGame('dames10', moves, { depth: 3, yieldControl: async () => undefined, sliceMs: 0 });
    expect(asyncA).toEqual(sync);
  });

  it('rejoue la notation officielle et refuse un coup illisible', () => {
    const states = replay('dames8', ['11-15', '22-18', '15x22']);
    expect(states).toHaveLength(4);
    expect(() => replay('dames10', ['32-27', '99-98'])).toThrow();
  });
});

describe('indice', () => {
  it('coup unique', () => {
    const state = fromPosition('dames10', boardFrom('dames10', { w: [32, 45], b: [27] }), 'w');
    expect(hintSync(state, { depth: 4 })).toMatchObject({ notation: '32x21', reason: 'only_move' });
  });

  it('aller à dame', () => {
    const state = fromPosition('dames10', boardFrom('dames10', { w: [7, 46], b: [36] }), 'w');
    const h = hintSync(state, { depth: 6 });
    expect(h.reason).toBe('promotion');
    expect([1, 2]).toContain(h.move.to);
  });
});

describe('taux d’accord avec le moteur (anti-triche)', () => {
  // Partie : les blancs jouent le coup du moteur (même réglage que l'analyse), les noirs au hasard.
  const budget = { depth: 3, maxNodesPerMove: 1e9 };
  const random = mulberry32(17);
  let state: DamesState = initialState('dames10');
  const moves: string[] = [];
  while (!state.result && moves.length < 120) {
    const m = state.turn === 'w' ? hintSync(state, budget).move : legalMoves(state)[Math.floor(random() * legalMoves(state).length)]!;
    moves.push(toNotation(m));
    state = applyMove(state, m);
  }

  it('le camp qui joue comme le moteur est signalé pour revue ; l’autre non', () => {
    const engine = agreementRateSync('dames10', moves, 'w', { ...budget, skipOpeningMoves: 0 });
    expect(engine.considered).toBeGreaterThanOrEqual(15);
    expect(engine.rate).toBe(1);
    expect(engine.averageLoss).toBeLessThanOrEqual(15);
    expect(engine.reviewNeeded).toBe(true);
    const human = agreementRateSync('dames10', moves, 'b', { ...budget, skipOpeningMoves: 0 });
    expect(human.rate).toBeLessThan(0.6);
    expect(human.reviewNeeded).toBe(false);
  });

  it('temps de réflexion trop réguliers', () => {
    const r = agreementRateSync('dames10', moves, 'w', { ...budget, skipOpeningMoves: 0, thinkTimesMs: [2000, 2010, 1990, 2000, 2005, 1995] });
    expect(r.thinkTimeVariation).toBeLessThan(0.05);
    const irregular = agreementRateSync('dames10', moves.slice(0, 12), 'w', { ...budget, skipOpeningMoves: 0, thinkTimesMs: [500, 9000, 1200, 30000, 2500, 800] });
    expect(irregular.thinkTimeVariation).toBeGreaterThan(0.5);
    expect(irregular.reviewNeeded).toBe(false);
  });
});
