import { describe, expect, it } from 'vitest';
import { applyMove, boardFrom, findLegal, fromPosition, initialState, legalMoves, type DamesState, type Variant } from '@kwatt/rules-dames';
import { Position, emoveKey } from './core.js';
import { defaultWeights } from './evaluate.js';
import { LEVEL_RATINGS, levelIdFor, levelProfile, levelWeights } from './levels.js';
import { chooseMove, chooseMoveSync } from './play.js';
import { mulberry32 } from './random.js';
import { Search, runSync } from './search.js';

function middlegames(variant: Variant, count: number, seed: number, plies: number): DamesState[] {
  const random = mulberry32(seed);
  const out: DamesState[] = [];
  while (out.length < count) {
    let state = initialState(variant);
    for (let i = 0; i < plies && !state.result; i++) {
      const moves = legalMoves(state);
      state = applyMove(state, moves[Math.floor(random() * moves.length)]!);
    }
    if (!state.result && legalMoves(state).length > 1) out.push(state);
  }
  return out;
}

/** Perte d'un coup par rapport au meilleur, mesurée par une recherche indépendante (profondeur 4). */
function lossOf(state: DamesState, key: string): number {
  const pos = Position.fromState(state);
  const r = runSync(new Search(pos, { weights: defaultWeights(pos.g.size), maxDepth: 4, multiMargin: 100_000, reductions: false }).run());
  const mine = r.rootScores.find((x) => emoveKey(x.move) === key)!;
  return r.rootScores[0]!.score - mine.score;
}

describe('niveaux par échelon (planche Moteur)', () => {
  it('forces visées : 800, 1 100, 1 350, 1 550, 1 800, Fon', () => {
    expect(LEVEL_RATINGS).toEqual({ apprenti: 800, debrouillard: 1100, ancien: 1350, notable: 1550, chef: 1800, fon: 2100 });
    expect(levelIdFor(820)).toBe('apprenti');
    expect(levelIdFor(1500)).toBe('notable');
    expect(levelIdFor(5000)).toBe('fon');
  });

  it('Apprenti : un demi-coup, sans quiétude (il ne voit pas la riposte) ; Débrouillard : 3 demi-coups', () => {
    const a = levelProfile(800);
    expect(a).toMatchObject({ id: 'apprenti', depth: 1, qDepth: 0, full: false });
    const d = levelProfile(1100);
    expect(d).toMatchObject({ id: 'debrouillard', depth: 3, qDepth: 0 });
    expect(levelProfile(1550)).toMatchObject({ id: 'notable', depth: 6, endgame: true });
    expect(levelProfile(1800)).toMatchObject({ id: 'chef', depth: 9 });
    expect(levelProfile(null).full).toBe(true);
    expect(levelProfile(2500).full).toBe(true);
  });

  it('plus la force monte, plus il voit loin, moins il hésite, moins il se trompe', () => {
    let prev = levelProfile(300);
    for (let r = 350; r <= 2050; r += 50) {
      const p = levelProfile(r);
      expect(p.depth).toBeGreaterThanOrEqual(prev.depth);
      expect(p.qDepth).toBeGreaterThanOrEqual(prev.qDepth);
      expect(p.maxNodes).toBeGreaterThanOrEqual(prev.maxNodes);
      expect(p.noise).toBeLessThanOrEqual(prev.noise);
      expect(p.cap).toBeLessThanOrEqual(prev.cap);
      prev = p;
    }
  });

  it('Ancien : structure fragile et finales approximatives (poids dégradés)', () => {
    const w = levelWeights(levelProfile(1350), 10);
    expect(w.structure).toBeLessThan(defaultWeights(10).structure);
    expect(w.endgame).toBe(false);
    expect(levelWeights(levelProfile(1800), 10).endgame).toBe(true);
  });
});

describe('chooseMove', () => {
  it('rend un coup légal pour rules-dames, à toutes les forces', () => {
    for (const variant of ['dames10', 'dames8'] as const) {
      const state = middlegames(variant, 1, 21, 16)[0]!;
      for (const targetRating of [500, 800, 1100, 1350, 1550]) {
        const c = chooseMoveSync(state, { targetRating, seed: 1 });
        expect(findLegal(state, { from: c.move.from, to: c.move.to, captures: c.move.captures })).not.toBeNull();
      }
      const full = chooseMoveSync(state, { maxNodes: 20_000 });
      expect(full.level).toBe('fon');
      expect(full.deliberate).toBe(false);
    }
  });

  it('limite de temps : un coup légal quand le temps est écoulé (horloge injectée)', () => {
    const state = middlegames('dames10', 1, 71, 12)[0]!;
    for (const targetRating of [1350, null]) {
      let t = 0;
      const c = chooseMoveSync(state, { targetRating, timeMs: 30, now: () => (t += 1) });
      expect(findLegal(state, { from: c.move.from, to: c.move.to, captures: c.move.captures })).not.toBeNull();
      expect(t).toBeLessThan(200);
    }
  });

  it('coup unique : joué tout de suite', () => {
    const state = fromPosition('dames10', boardFrom('dames10', { w: [32, 35, 37, 43], b: [1, 8, 14, 18, 28, 30] }), 'w');
    const c = chooseMoveSync(state, { targetRating: 800 });
    expect(c.notation).toBe('32x23x12x3');
    expect(c.nodes).toBe(0);
  });

  it('déterministe par graine ; la graine change les erreurs des échelons bas', () => {
    const states = middlegames('dames10', 8, 31, 14);
    const pick = (seed: number) => states.map((s) => chooseMoveSync(s, { targetRating: 800, seed }).notation);
    expect(pick(5)).toEqual(pick(5));
    const variants = new Set([1, 2, 3, 4, 5, 6].map((seed) => pick(seed).join(' ')));
    expect(variants.size).toBeGreaterThan(1);
  });

  it('version asynchrone : rend la main, même coup que la version synchrone', async () => {
    const state = middlegames('dames10', 1, 41, 18)[0]!;
    let yields = 0;
    let t = 0;
    const options = { targetRating: 1350, seed: 9 };
    const a = await chooseMove(state, { ...options, sliceMs: 2, now: () => (t += 1), yieldControl: async () => void yields++ });
    const s = chooseMoveSync(state, options);
    expect(a.notation).toBe(s.notation);
    expect(yields).toBeGreaterThan(0);
  });

  it('jamais un coup absurde : la perte reste sous le plafond du niveau', () => {
    const states = middlegames('dames10', 24, 51, 20);
    for (const rating of [800, 1100]) {
      const cap = levelProfile(rating).cap;
      for (const [i, s] of states.entries()) {
        const c = chooseMoveSync(s, { targetRating: rating, seed: i });
        const loss = lossOf(s, emoveKey({ from: c.move.from, to: c.move.to, caps: c.move.captures }));
        expect(loss).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('erreurs crédibles : l’Apprenti se trompe plus souvent que le Notable', () => {
    const states = middlegames('dames10', 24, 61, 22);
    const mistakes = (rating: number): number =>
      states.filter((s, i) => {
        const c = chooseMoveSync(s, { targetRating: rating, seed: i, maxNodes: 30_000 });
        return lossOf(s, emoveKey({ from: c.move.from, to: c.move.to, caps: c.move.captures })) >= 60;
      }).length;
    const apprenti = mistakes(800);
    const notable = mistakes(1550);
    expect(apprenti).toBeGreaterThan(notable);
    expect(apprenti).toBeGreaterThan(0);
  });
});
