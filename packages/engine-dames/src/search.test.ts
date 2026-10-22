import { describe, expect, it } from 'vitest';
import { applyMove, boardFrom, fromPosition, initialState, legalMoves, type Piece, type Variant } from '@kwatt/rules-dames';
import { Position, emoveNotation, geometry } from './core.js';
import { defaultWeights, evaluate, evaluateTerms, endgameFactor } from './evaluate.js';
import { mulberry32 } from './random.js';
import { MATE, MATE_BOUND, Search, SearchCancelledError, runAsync, runSync } from './search.js';

/** Minimax sans élagage, avec les mêmes règles d'extension et de quiétude. */
function bruteForce(pos: Position, depth: number, ply: number): number {
  const w = defaultWeights(pos.g.size);
  const quiesce = (p: number): number => {
    const caps: ReturnType<Position['legalMoves']> = [];
    pos.genCaptures(caps);
    if (caps.length === 0) return pos.hasQuietMove() ? evaluate(pos, w) : -MATE + p;
    let best = -Infinity;
    for (const m of caps) {
      pos.make(m);
      best = Math.max(best, -quiesce(p + 1));
      pos.unmake();
    }
    return best;
  };
  if (ply > 0 && (pos.isRepetition() || pos.isQuietDraw())) return 0;
  if (depth <= 0) return quiesce(ply);
  const moves = pos.legalMoves();
  if (moves.length === 0) return -MATE + ply;
  // Comme la recherche : pas d'extension à la racine.
  const next = moves.length === 1 && ply > 0 && ply < 60 ? depth : depth - 1;
  let best = -Infinity;
  for (const m of moves) {
    pos.make(m);
    best = Math.max(best, -bruteForce(pos, next, ply + 1));
    pos.unmake();
  }
  return best;
}

/** Positions de milieu de partie (pions seulement) tirées de parties aléatoires. */
function randomMiddlegames(variant: Variant, count: number, seed: number, plies = 24): Position[] {
  const random = mulberry32(seed);
  const out: Position[] = [];
  while (out.length < count) {
    let state = initialState(variant);
    for (let i = 0; i < plies && !state.result; i++) {
      const moves = legalMoves(state);
      state = applyMove(state, moves[Math.floor(random() * moves.length)]!);
    }
    if (!state.result) out.push(Position.fromState(state));
  }
  return out;
}

describe('recherche alpha-bêta', () => {
  it('même valeur qu’un minimax sans élagage (table de transposition comprise)', () => {
    for (const variant of ['dames10', 'dames8'] as const) {
      for (const pos of randomMiddlegames(variant, 12, variant === 'dames10' ? 5 : 6, 30)) {
        const expected = bruteForce(pos, 3, 0);
        const r = runSync(new Search(pos, { weights: defaultWeights(pos.g.size), maxDepth: 3, reductions: false }).run());
        expect(r.score).toBe(expected);
        expect(r.depth).toBe(3);
      }
    }
  });

  it('mode « plusieurs coups » : scores exacts de chaque coup de la racine', () => {
    const [pos] = randomMiddlegames('dames10', 1, 11, 20);
    const r = runSync(new Search(pos!, { weights: defaultWeights(10), maxDepth: 2, multiMargin: 10_000 }).run());
    for (const root of r.rootScores) {
      expect(root.exact).toBe(true);
      pos!.make(root.move);
      expect(root.score).toBe(-bruteForce(pos!, 1, 1));
      pos!.unmake();
    }
    expect(r.rootScores[0]!.score).toBe(r.score);
  });

  it('voit le gain : prendre le dernier pion adverse', () => {
    const pos = Position.fromState(fromPosition('dames10', boardFrom('dames10', { w: [32, 45], b: [27] }), 'w'));
    const r = runSync(new Search(pos, { weights: defaultWeights(10), maxDepth: 6 }).run());
    expect(emoveNotation(r.best!)).toBe('32x21');
    expect(r.score).toBeGreaterThan(MATE_BOUND);
  });

  it('camp bloqué : aucun coup = partie perdue', () => {
    // 8×8 : le pion noir de la case 28 n'a aucun coup (noirs vers le bas, case 32 occupée, bord).
    const state = fromPosition('dames8', boardFrom('dames8', { b: [28], w: [32] }), 'b');
    const pos = Position.fromState(state);
    expect(pos.legalMoves()).toHaveLength(0);
    const r = runSync(new Search(pos, { weights: defaultWeights(8), maxDepth: 4 }).run());
    expect(r.best).toBeNull();
    expect(r.score).toBe(-MATE);
  });

  it('limite de nœuds respectée et résultat utilisable', () => {
    const pos = Position.fromState(initialState('dames10'));
    const r = runSync(new Search(pos, { weights: defaultWeights(10), maxNodes: 5000 }).run());
    expect(r.stopped).toBe(true);
    expect(r.nodes).toBeLessThan(5000 + 4200);
    expect(r.best).not.toBeNull();
    // La position n'a pas bougé.
    expect(pos.toBoard()).toEqual(initialState('dames10').board);
  });

  it('limite de temps (horloge injectée)', () => {
    let t = 0;
    const pos = Position.fromState(initialState('dames10'));
    const r = runSync(new Search(pos, { weights: defaultWeights(10), timeMs: 50, now: () => (t += 1), yieldEvery: 256 }).run());
    expect(r.stopped).toBe(true);
    expect(r.best).not.toBeNull();
  });

  it('déterministe : deux recherches identiques donnent le même coup et le même nombre de nœuds', () => {
    const run = () => runSync(new Search(Position.fromState(initialState('dames8')), { weights: defaultWeights(8), maxDepth: 7 }).run());
    const a = run();
    const b = run();
    expect(emoveNotation(a.best!)).toBe(emoveNotation(b.best!));
    expect(a.nodes).toBe(b.nodes);
    expect(a.pv.map(emoveNotation)).toEqual(b.pv.map(emoveNotation));
  });

  it('version découpée : rend la main pendant le calcul, même résultat', async () => {
    let yields = 0;
    const pos = () => Position.fromState(initialState('dames10'));
    const options = { weights: defaultWeights(10), maxDepth: 7, yieldEvery: 512 };
    const sync = runSync(new Search(pos(), options).run());
    let t = 0;
    const asyncResult = await runAsync(new Search(pos(), options).run(), {
      sliceMs: 5,
      now: () => (t += 1),
      yieldControl: async () => {
        yields++;
      },
    });
    expect(yields).toBeGreaterThan(0);
    expect(emoveNotation(asyncResult.best!)).toBe(emoveNotation(sync.best!));
    expect(asyncResult.score).toBe(sync.score);
  });

  it('annulation', async () => {
    const signal = { aborted: false };
    const p = runAsync(new Search(Position.fromState(initialState('dames10')), { weights: defaultWeights(10), maxDepth: 12, yieldEvery: 256 }).run(), {
      sliceMs: 0,
      signal,
      yieldControl: async () => {
        signal.aborted = true;
      },
    });
    await expect(p).rejects.toBeInstanceOf(SearchCancelledError);
  });
});

describe('évaluation', () => {
  it('position de départ : équilibrée', () => {
    for (const variant of ['dames10', 'dames8'] as const) {
      const t = evaluateTerms(Position.fromState(initialState(variant)));
      expect(t.material).toBe(0);
      expect(Math.abs(t.total)).toBeLessThanOrEqual(10);
    }
  });

  it('symétrique : retourner le damier et les couleurs change le signe', () => {
    const random = mulberry32(3);
    for (const variant of ['dames10', 'dames8'] as const) {
      const g = geometry(variant);
      for (let i = 0; i < 50; i++) {
        const board: Piece[] = Array.from({ length: g.n }, () => '' as Piece);
        for (let k = 0; k < 14; k++) {
          const s = 1 + Math.floor(random() * g.n);
          const r = g.row[s]!;
          let p: Piece = (['w', 'b', 'W', 'B'] as const)[Math.floor(random() * 4)]!;
          if (p === 'w' && r === 0) p = 'W';
          if (p === 'b' && r === g.size - 1) p = 'B';
          board[s - 1] = p;
        }
        // Rotation de 180° : la case s devient n + 1 − s, les couleurs s'échangent.
        const flipped = board.map((_, i2) => {
          const p = board[g.n - 1 - i2]!;
          return (p === 'w' ? 'b' : p === 'b' ? 'w' : p === 'W' ? 'B' : p === 'B' ? 'W' : '') as Piece;
        });
        const a = evaluateTerms(Position.fromState(fromPosition(variant, board, 'w'))).total;
        const b = evaluateTerms(Position.fromState(fromPosition(variant, flipped, 'w'))).total;
        expect(a + b).toBe(0);
      }
    }
  });

  it('chaque terme a le bon sens', () => {
    const terms = (pieces: Parameters<typeof boardFrom>[1]) => evaluateTerms(Position.fromState(fromPosition('dames10', boardFrom('dames10', pieces), 'w')));
    expect(terms({ w: [31, 32], b: [20] }).material).toBe(100);
    expect(terms({ W: [28], b: [20] }).material).toBe(220);
    // Avancement : un pion blanc près de la promotion vaut plus qu'un pion resté chez lui.
    expect(terms({ w: [11], b: [5] }).advancement).toBeGreaterThan(terms({ w: [46], b: [5] }).advancement);
    // Centre.
    expect(terms({ w: [28], b: [5] }).center).toBeGreaterThan(terms({ w: [36], b: [5] }).center);
    // Arrière : pion blanc sur sa dernière ligne.
    expect(terms({ w: [48], b: [5] }).backRank).toBeGreaterThan(terms({ w: [42], b: [5] }).backRank);
    // Structure : pion soutenu par derrière.
    expect(terms({ w: [28, 32, 33], b: [5] }).structure).toBeGreaterThan(terms({ w: [28, 41, 45], b: [5] }).structure);
    // Mobilité : pion bloqué.
    expect(terms({ w: [28], b: [3] }).mobility).toBeGreaterThan(terms({ w: [28], b: [22, 23] }).mobility);
    // Dame sur la grande diagonale.
    expect(terms({ W: [28], b: [5] }).kingPlacement).toBeGreaterThan(terms({ W: [27], b: [5] }).kingPlacement);
  });

  it('finales de dames : nulles reconnues', () => {
    const pos = (pieces: Parameters<typeof boardFrom>[1], variant: Variant = 'dames10') =>
      Position.fromState(fromPosition(variant, boardFrom(variant, pieces), 'w'));
    expect(endgameFactor(pos({ W: [28], B: [5] }))).toBe(0);
    expect(endgameFactor(pos({ W: [28, 33], B: [5] }))).toBe(1 / 16);
    expect(endgameFactor(pos({ W: [28, 33, 38], B: [5] }))).toBe(1 / 4);
    expect(endgameFactor(pos({ W: [28, 33, 38, 43], B: [5] }))).toBe(1);
    expect(endgameFactor(pos({ W: [18], B: [5] }, 'dames8'))).toBe(0);
    expect(endgameFactor(pos({ W: [18, 22], B: [5] }, 'dames8'))).toBe(1);
  });
});
