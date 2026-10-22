import {
  applyLegalMove,
  applyRoll,
  BASE,
  distinctMoves,
  legalMoves,
  newGame,
  throwDistribution,
  type LudoMove,
  type LudoState,
  type NewGameOptions,
} from '@kwatt/rules-ludo';
import { describe, expect, it } from 'vitest';
import { expectimaxAgent } from './agents/expectimax.js';
import { heuristicAgent, scoreAll } from './agents/heuristic.js';
import { mctsAgent } from './agents/mcts.js';
import { randomAgent } from './agents/random.js';
import { chooseMove, MAX_BUDGET_MS, NoMoveError } from './choose.js';
import { utilities } from './position.js';
import { createRng, sample } from './rng.js';
import { LEVELS, type Agent, type AgentContext } from './types.js';

const B = BASE;

function position(state: LudoState, tokens: number[][], roll: number, current = 0): LudoState {
  return applyRoll({ ...state, tokens, current, phase: 'roll', roll: null, sixesInRow: 0, bonus: [], extraRoll: false, lastMoved: null }, roll);
}

/** Position de milieu de partie (coups au hasard), avec au moins deux coups distincts. */
function midgame(options: NewGameOptions, seed: number, plies = 120): LudoState | null {
  const rng = createRng(seed);
  let g = newGame(options);
  const dist = throwDistribution(g.config.mechanics.throw);
  let n = 0;
  while (g.phase !== 'over') {
    if (g.phase === 'roll') g = applyRoll(g, sample(dist, rng));
    else if (n >= plies && distinctMoves(legalMoves(g)).length >= 2) return g;
    else {
      const m = legalMoves(g);
      g = applyLegalMove(g, m[rng.int(m.length)]!);
      n++;
    }
  }
  return null;
}

const VARIANTS: NewGameOptions[] = [
  { preset: 'classique', players: 2 },
  { preset: 'classique', players: 4, teams: [[0, 2], [1, 3]] },
  { preset: 'rapide', players: 3 },
  { preset: 'six', players: 6 },
  { preset: 'parchis', players: 4 },
  { preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] },
  { preset: 'classique', players: 4, house: { barriers: 'six_opens', capture: 'home_bonus20' } },
];

const ctx = (seat: number, seed = 1, maxIterations?: number): AgentContext => ({
  seat,
  rng: createRng(seed),
  now: () => 0,
  deadline: 1e12,
  ...(maxIterations !== undefined ? { maxIterations } : {}),
});

const key = (m: LudoMove): string => `${m.seat}:${m.token}:${m.from}>${m.to}`;

describe('heuristique explicable', () => {
  it('prend quand il peut, et le dit', () => {
    // Classique à 2 : siège 1 en maison 2 ; son pion en case 7 (prog 33), le nôtre peut le prendre avec un 3.
    const g = position(newGame({ preset: 'classique', players: 2 }), [[4, 20, B, B], [33, B, B, B]], 3);
    const cands = scoreAll(g, distinctMoves(legalMoves(g)), 0);
    const best = cands.reduce((a, b) => (b.score > a.score ? b : a));
    expect(best.move.captures).toHaveLength(1);
    expect(best.reasons!.map((r) => r.code)).toContain('capture');
    for (const c of cands) {
      expect(c.pCapture).toBeGreaterThanOrEqual(0);
      expect(c.pSafe).toBeLessThanOrEqual(1);
    }
  });

  it('met à l’abri un pion menacé plutôt qu’avancer un pion tranquille', () => {
    // Notre pion en case 10 a un adversaire 2 cases derrière (case 8, étoile : lui est à l'abri).
    // Avec un 3, le pion menacé (10 → 13 = départ adverse, protégé) fuit ; l'autre pion (30) est loin de tout.
    const g = position(newGame({ preset: 'classique', players: 2 }), [[10, 30, B, B], [34, B, B, B]], 3);
    const cands = scoreAll(g, distinctMoves(legalMoves(g)), 0);
    const best = cands.reduce((a, b) => (b.score > a.score ? b : a));
    expect(best.move.from).toBe(10);
    expect(best.reasons!.find((r) => r.code === 'danger')!.value).toBeGreaterThan(0);
    expect(cands.find((c) => c.move.from === 30)!.pSafe).toBeLessThan(best.pSafe!);
  });

  it('rentre un pion plutôt que de rester dans le couloir', () => {
    const g = position(newGame({ preset: 'classique', players: 2 }), [[53, 5, B, B], [B, B, B, B]], 3);
    const d = heuristicAgent().choose(g, distinctMoves(legalMoves(g)), ctx(0));
    expect(d.move.to).toBe(56);
  });

  it('Parchís : la capture vaut plus avec son bonus de 20', () => {
    const g = position(newGame({ preset: 'parchis', players: 2 }), [[3, 30, B, B], [(10 - 5 - 34 + 136) % 68, B, B, B]], 2);
    const cands = scoreAll(g, distinctMoves(legalMoves(g)), 0);
    const cap = cands.find((c) => c.move.captures.length > 0)!;
    expect(cap.reasons!.map((r) => r.code)).toEqual(expect.arrayContaining(['capture', 'bonus']));
  });
});

describe('tous les agents, toutes les variantes : un coup légal', () => {
  const agents: [string, Agent, number | undefined][] = [
    ['aléatoire', randomAgent(), undefined],
    ['heuristique', heuristicAgent(), undefined],
    ['heuristique rapide', heuristicAgent({ threats: 'fast', temperature: 0.2 }), undefined],
    ['expectimax max-n', expectimaxAgent({ depth: 2, mode: 'maxn' }), 4000],
    ['expectimax paranoïaque', expectimaxAgent({ depth: 2, mode: 'paranoid' }), 4000],
    ['MCTS', mctsAgent(), 60],
  ];
  it.each(agents)('%s', (_name, agent, iters) => {
    VARIANTS.forEach((options, v) => {
      for (const seed of [1, 2]) {
        const g = midgame(options, seed * 31 + v);
        if (!g) continue;
        const moves = distinctMoves(legalMoves(g));
        const d = agent.choose(g, moves, ctx(g.current, seed, iters));
        expect(moves.map(key)).toContain(key(d.move));
        expect(d.candidates).toHaveLength(moves.length);
      }
    });
  });
});

describe('expectimax', () => {
  it('profondeur 1 : le meilleur coup selon l’évaluation juste après', () => {
    const g = midgame({ preset: 'classique', players: 3 }, 5)!;
    const moves = distinctMoves(legalMoves(g));
    const d = expectimaxAgent({ depth: 1 }).choose(g, moves, ctx(g.current));
    const values = moves.map((m) => utilities(applyLegalMove(g, m))[g.current]!);
    expect(d.candidates.map((c) => c.score)).toEqual(values);
    expect(d.stats.depth).toBe(1);
  });

  it('approfondit tant que le plafond de nœuds le permet, de façon reproductible', () => {
    const g = midgame({ preset: 'classique', players: 4 }, 9)!;
    const moves = distinctMoves(legalMoves(g));
    const small = expectimaxAgent({ depth: 3 }).choose(g, moves, ctx(g.current, 1, 30));
    const big = expectimaxAgent({ depth: 3 }).choose(g, moves, ctx(g.current, 1, 1e7));
    expect(small.stats.depth).toBe(1);
    expect(big.stats.depth).toBe(3);
    expect(expectimaxAgent({ depth: 3 }).choose(g, moves, ctx(g.current, 1, 1e7))).toEqual(big);
  });
});

describe('MCTS', () => {
  it('chaque simulation passe par un coup de la racine ; même graine, même choix', () => {
    const g = midgame({ preset: 'classique', players: 4 }, 3)!;
    const moves = distinctMoves(legalMoves(g));
    const d = mctsAgent().choose(g, moves, ctx(g.current, 7, 200));
    expect(d.stats.sims).toBe(200);
    expect(d.candidates.reduce((s, c) => s + c.visits!, 0)).toBe(200);
    for (const c of d.candidates) expect(c.ev).toBeGreaterThanOrEqual(0);
    expect(mctsAgent().choose(g, moves, ctx(g.current, 7, 200))).toEqual(d);
  });

  it('s’arrête au temps imparti', () => {
    const g = midgame({ preset: 'classique', players: 2 }, 4)!;
    const moves = distinctMoves(legalMoves(g));
    let t = 0;
    const d = mctsAgent({ minSims: 16 }).choose(g, moves, { seat: g.current, rng: createRng(1), now: () => (t += 10), deadline: 100 });
    expect(d.stats.sims).toBeLessThan(200);
    expect(d.stats.sims).toBeGreaterThanOrEqual(16);
  });
});

describe('chooseMove', () => {
  it('les 5 niveaux répondent avec un coup légal et des candidats', () => {
    const g = midgame({ preset: 'classique', players: 4 }, 12)!;
    for (const level of LEVELS) {
      const r = chooseMove({ state: g, level, maxIterations: 300 });
      expect(legalMoves(g).map(key)).toContain(key(r.move));
      expect(r.level).toBe(level);
      expect(r.agent).toMatch(/@\d+$/);
      expect(r.stats.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('même position, même graine : même choix (Fon compris, à itérations fixées)', () => {
    const g = midgame({ preset: 'parchis', players: 3 }, 2)!;
    const a = chooseMove({ state: g, level: 'fon', maxIterations: 150 });
    const b = chooseMove({ state: g, level: 'fon', maxIterations: 150 });
    expect(key(a.move)).toBe(key(b.move));
    expect(a.candidates).toEqual(b.candidates);
  });

  it('un seul coup distinct : joué tout de suite', () => {
    const g = applyRoll(newGame({ preset: 'classique', players: 2 }), 6);
    const r = chooseMove({ state: g, level: 'fon' });
    expect(r.move.from).toBe(BASE);
    expect(r.candidates).toHaveLength(1);
    expect(r.stats.sims).toBeUndefined();
  });

  it('les coups proposés illégaux sont ignorés ; sans coup, une erreur', () => {
    const g = position(newGame({ preset: 'classique', players: 2 }), [[4, 20, B, B], [B, B, B, B]], 3);
    const fake: LudoMove = { seat: 0, token: 0, from: 4, to: 40, captures: [] };
    const r = chooseMove({ state: g, level: 'coriace', legal: [fake] });
    expect(legalMoves(g).map(key)).toContain(key(r.move));
    const only = legalMoves(g).find((m) => m.from === 20)!;
    expect(chooseMove({ state: g, level: 'coriace', legal: [only] }).move).toEqual(only);
    expect(() => chooseMove({ state: newGame({ preset: 'classique', players: 2 }), level: 'facile' })).toThrow(NoMoveError);
  });

  it('le budget est plafonné', () => {
    const g = midgame({ preset: 'classique', players: 2 }, 8)!;
    let t = 0;
    const r = chooseMove({ state: g, level: 'fon', budgetMs: 1e9, now: () => (t += 50) });
    expect(r.stats.elapsedMs).toBeLessThanOrEqual(MAX_BUDGET_MS + 50 * 40);
  });
});
