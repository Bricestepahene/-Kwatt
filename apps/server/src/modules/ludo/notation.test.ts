/**
 * La notation écrite par l'appli (enregistreur de @kwatt/rules-ludo, partie locale du Ludo) est
 * celle que rejoue le serveur pour les résultats hors connexion (C2, module machine).
 */
import { applyLegalMove, applyRoll, COWRIE_VALUES, emptyLog, legalMoves, newGame, recordMove, recordRoll, type Preset } from '@kwatt/rules-ludo';
import { describe, expect, it } from 'vitest';
import { ludoSetup, replayLudo } from '../machine/replay.js';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

function play(variant: string, machines: number, seed: number) {
  const rnd = lcg(seed);
  let state = newGame(ludoSetup(variant, machines));
  let log = emptyLog();
  while (state.phase !== 'over') {
    if (state.phase === 'roll') {
      const v = state.config.mechanics.throw === 'dice' ? 1 + Math.floor(rnd() * 6) : COWRIE_VALUES[Math.floor(rnd() * 7)]!;
      state = applyRoll(state, v);
      log = recordRoll(log, state, v);
    } else {
      const ms = legalMoves(state);
      const m = ms[Math.floor(rnd() * ms.length)]!;
      log = recordMove(log, state, m);
      state = applyLegalMove(state, m);
    }
  }
  return { state, moves: log.moves };
}

describe('notation du Ludo : appli → rejeu du serveur', () => {
  const cases: [Preset, number][] = [
    ['classique', 1],
    ['classique', 3],
    ['rapide', 2],
    ['six', 3],
    ['parchis', 3],
    ['pachisi', 3],
  ];
  it.each(cases)('%s contre %i machine(s)', (preset, machines) => {
    for (let seed = 1; seed <= 3; seed++) {
      const { state, moves } = play(`ludo_${preset}`, machines, seed * 31 + machines);
      const r = replayLudo(`ludo_${preset}`, machines, moves);
      const places = state.seats.map((_, seat) => state.ranking.indexOf(seat) + 1);
      expect(r.places).toEqual(places);
      expect(r.reason).toBe('all_home');
    }
  });
});
