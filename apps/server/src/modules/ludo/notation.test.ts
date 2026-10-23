/**
 * La notation écrite par l'appli (enregistreur de @kwatt/rules-ludo, partie locale du Ludo) est
 * celle que rejoue le serveur pour les résultats hors connexion (C2, module machine).
 */
import { applyLegalMove, applyRoll, COWRIE_VALUES, emptyLog, legalMoves, newGame, recordMove, recordQuit, recordRoll, type Preset } from '@kwatt/rules-ludo';
import { describe, expect, it } from 'vitest';
import { InvalidGameError, ludoSetup, replayLudo } from '../machine/replay.js';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

function play(variant: string, machines: number, seed: number, maxSteps = Infinity) {
  const rnd = lcg(seed);
  let state = newGame(ludoSetup(variant, machines));
  let log = emptyLog();
  for (let i = 0; i < maxSteps && state.phase !== 'over'; i++) {
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

  it('Rapide abandonné : perdu et dernier, jamais « fini au temps »', () => {
    // Partie Rapide arrêtée tôt : au temps, le classement suivrait la progression.
    for (let seed = 1; seed <= 20; seed++) {
      const log = play('ludo_rapide', 2, seed, 120).moves;
      const quit = recordQuit({ moves: log, pendingRoll: null }, 0).moves;
      const r = replayLudo('ludo_rapide', 2, quit);
      expect(r).toEqual({ outcome: 'loss', places: [3, 1, 2], reason: 'resign' });
    }
  });

  it('refuse un abandon d’une machine ou suivi d’autres coups', () => {
    const { moves } = play('ludo_classique', 1, 5, 40);
    const refused = (m: string[]) => {
      try {
        replayLudo('ludo_classique', 1, m);
      } catch (err) {
        return err instanceof InvalidGameError ? err.reason : 'autre';
      }
      return null;
    };
    expect(refused([...moves, 'x:1'])).toBe('quit_seat');
    expect(refused([...moves, 'x:0', '6:-'])).toBe('after_quit');
  });
});
