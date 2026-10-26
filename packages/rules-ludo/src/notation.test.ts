import { describe, expect, it } from 'vitest';
import { applyLegalMove, applyRoll, endOnTime, legalMoves, newGame, removeSeat, type LudoState } from './engine.js';
import { emptyLog, LUDO_NOTATION, quitSeat, recordMove, recordQuit, recordRoll, replayNotation, replayStates, tokenNotation, type NotationLog } from './notation.js';
import { COWRIE_VALUES, type NewGameOptions } from './variants.js';

/** Générateur pseudo-aléatoire reproductible (tests seulement). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function playRandom(options: NewGameOptions, seed: number, maxSteps = 4000): { state: LudoState; log: NotationLog } {
  const rnd = lcg(seed);
  let state = newGame(options);
  let log = emptyLog();
  for (let i = 0; i < maxSteps && state.phase !== 'over'; i++) {
    if (state.phase === 'roll') {
      const value = state.config.mechanics.throw === 'dice' ? 1 + Math.floor(rnd() * 6) : COWRIE_VALUES[Math.floor(rnd() * 7)]!;
      state = applyRoll(state, value);
      log = recordRoll(log, state, value);
    } else {
      const moves = legalMoves(state);
      const move = moves[Math.floor(rnd() * moves.length)]!;
      log = recordMove(log, state, move);
      state = applyLegalMove(state, move);
    }
  }
  return { state, log };
}

const SETUPS: NewGameOptions[] = [
  { preset: 'classique', players: 4 },
  { preset: 'classique', players: 4, teams: [[0, 2], [1, 3]] },
  { preset: 'rapide', players: 3 },
  { preset: 'six', players: 4 },
  { preset: 'parchis', players: 4, teams: [[0, 2], [1, 3]] },
  { preset: 'parchis', players: 2 },
  { preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] },
  { preset: 'classique', players: 2, house: { capture: 'home_bonus20', barriers: 'six_opens' } },
];

describe('notation des parties de Ludo', () => {
  it.each(SETUPS.map((s, i) => [s.preset, i, s] as const))('%s (%i) : la notation rejoue la partie à l’identique', (_, i, setup) => {
    const { state, log } = playRandom(setup, 100 + i);
    expect(state.phase).toBe('over');
    expect(log.pendingRoll).toBeNull();
    for (const m of log.moves) expect(m).toMatch(LUDO_NOTATION);
    expect(replayNotation(setup, log.moves)).toEqual(state);
    const states = replayStates(setup, log.moves);
    expect(states).toHaveLength(log.moves.length + 1);
    expect(states[states.length - 1]).toEqual(state);
  });

  it('les coups bonus du Parchís et les pions du partenaire ont leur notation', () => {
    const all = SETUPS.filter((s) => s.preset === 'parchis' || s.preset === 'pachisi').flatMap((s, i) => playRandom(s, 300 + i).log.moves);
    expect(all.some((m) => m.startsWith('b:'))).toBe(true);
    expect(all.some((m) => /^\d+:\d\.\d$/.test(m))).toBe(true);
    expect(all.some((m) => m.endsWith(':-'))).toBe(true);
  });

  it('reprend une partie avec un lancer en attente', () => {
    const setup: NewGameOptions = { preset: 'classique', players: 2 };
    let state = applyRoll(newGame(setup), 6);
    const log = recordRoll(emptyLog(), state, 6);
    expect(log).toEqual({ moves: [], pendingRoll: 6 });
    expect(replayNotation(setup, log.moves, log.pendingRoll)).toEqual(state);
    const move = legalMoves(state)[0]!;
    const after = recordMove(log, state, move);
    expect(after.moves).toEqual(['6:0']);
    state = applyLegalMove(state, move);
    expect(replayNotation(setup, after.moves)).toEqual(state);
  });

  it('refuse une entrée illisible, un coup sauté ou un coup impossible', () => {
    const setup: NewGameOptions = { preset: 'classique', players: 2 };
    expect(() => replayNotation(setup, ['6'])).toThrow('ludo.move.illegal');
    expect(() => replayNotation(setup, ['6:-'])).toThrow('ludo.move.illegal');
    expect(() => replayNotation(setup, ['3:0'])).toThrow('ludo.move.not_now');
    expect(() => replayNotation(setup, ['b:0'])).toThrow('ludo.move.not_now');
    expect(() => replayNotation(setup, ['7:-'])).toThrow('ludo.roll.invalid_value');
  });

  it('pion du partenaire : siège et pion', () => {
    expect(tokenNotation({ current: 0 }, { seat: 0, token: 3 })).toBe('3');
    expect(tokenNotation({ current: 0 }, { seat: 2, token: 1 })).toBe('2.1');
  });

  it('abandon : « x:siège » retire le siège, annule le lancer en attente et se rejoue', () => {
    const setup: NewGameOptions = { preset: 'rapide', players: 3 };
    const { log } = playRandom(setup, 7, 60);
    const before = replayNotation(setup, log.moves);
    // Un lancer en attente au moment de l'abandon (s'il y a lieu de lancer).
    const pending = before.phase === 'roll' ? recordRoll(log, applyRoll(before, 6), 6) : log;
    const quit = recordQuit(pending, 0);
    expect(quit.pendingRoll).toBeNull();
    expect(quit.moves[quit.moves.length - 1]).toBe('x:0');
    expect(quit.moves[quit.moves.length - 1]).toMatch(LUDO_NOTATION);
    expect(quitSeat('x:2')).toBe(2);
    expect(quitSeat('6:2')).toBeNull();
    const replayed = replayNotation(setup, quit.moves);
    expect(replayed).toEqual(removeSeat(replayNotation(setup, pending.moves), 0));
    expect(replayed.seats[0]!.status).toBe('out');
    // Fin de la partie locale : classement à la progression, le joueur sorti dernier.
    const end = endOnTime(replayed);
    expect(end.phase).toBe('over');
    expect([-1, end.seats.length - 1]).toContain(end.ranking.indexOf(0));
    expect(replayStates(setup, quit.moves)).toHaveLength(quit.moves.length + 1);
  });

  it('refuse la sortie d’un siège inconnu ou après la fin', () => {
    const setup: NewGameOptions = { preset: 'classique', players: 2 };
    expect(() => replayNotation(setup, ['x:5'])).toThrow('ludo.seat.invalid');
    const { log } = playRandom(setup, 11);
    expect(() => replayNotation(setup, [...log.moves, 'x:0'])).toThrow('ludo.move.not_now');
  });
});
