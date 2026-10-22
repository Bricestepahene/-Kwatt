import { chooseMoveSync } from '@kwatt/engine-dames';
import { applyMove, initialState, moveKey, parseNotation } from '@kwatt/rules-dames';
import { describe, expect, it } from 'vitest';
import { memoryStore } from '../../storage/kv';
import type { LocalGame } from '../game/historyStore';
import { LOCAL_DAMES_KEY, LocalDamesController, newSeed, readLocalDames, type LocalDamesOptions } from './localGame';

const options = (over: Partial<LocalDamesOptions> = {}): LocalDamesOptions => ({
  id: 'local-1',
  variant: 'dames8',
  difficulty: 'facile',
  mode: 'auto',
  machineRating: 520,
  seed: 1234,
  player: { userId: 'u1', name: 'Brice' },
  machineName: 'Machine',
  startedAt: '2026-10-22T10:00:00.000Z',
  ...over,
});

function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (cond()) resolve();
      else if (Date.now() - start > ms) reject(new Error('délai dépassé'));
      else setTimeout(tick, 5);
    };
    tick();
  });
}

describe('partie locale contre la machine', () => {
  it('en 8×8 la machine (noirs) commence ; le joueur joue ; la partie est gardée et reprend', async () => {
    const storage = memoryStore();
    const c = LocalDamesController.start(options(), { storage, machineDelayMs: 0 });
    expect(c.legalMoves()).toEqual([]); // pas à toi
    await waitFor(() => c.getState().turn === 'w');
    expect(c.history()).toHaveLength(1);
    const move = c.legalMoves()[0]!;
    c.play(move);
    await waitFor(() => c.history().length === 3);
    await c.whenSaved();

    const saved = await readLocalDames(storage);
    expect(saved?.moves).toEqual(c.history());
    const again = new LocalDamesController(saved!, { storage, machineDelayMs: 0 });
    expect(again.getState()).toEqual(c.getState());
    c.dispose();
    again.dispose();
  });

  it('les coups de la machine sont ceux que le serveur recalcule (chooseMoveSync, même graine)', async () => {
    const storage = memoryStore();
    const c = LocalDamesController.start(options({ variant: 'dames10', seed: 99, machineRating: 1100 }), { storage, machineDelayMs: 0 });
    for (let i = 0; i < 3; i++) {
      await waitFor(() => c.legalMoves().length > 0);
      c.play(c.legalMoves()[0]!);
    }
    await waitFor(() => c.history().length === 6);
    let s = initialState('dames10');
    for (const text of c.history()) {
      const m = parseNotation(s, text)!;
      if (s.turn === 'b') expect(moveKey(chooseMoveSync(s, { targetRating: 1100, seed: 99 }).move)).toBe(moveKey(m));
      s = applyMove(s, m);
    }
    c.dispose();
  });

  it('abandon : défaite, partie retirée de l’appareil, historique prêt pour l’envoi', async () => {
    const storage = memoryStore();
    const finished: LocalGame[] = [];
    const c = LocalDamesController.start(options({ variant: 'dames10' }), { storage, machineDelayMs: 0, onFinished: (g) => void finished.push(g) });
    c.resign();
    await c.whenSaved();
    expect(c.outcome()).toEqual({ places: { 0: 2, 1: 1 }, draw: false, reason: 'resign' });
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ id: 'local-1', family: 'dames', moves: [], machine: { pending: true, offline: true } });
    expect(storage.dump()[LOCAL_DAMES_KEY]).toBeUndefined();
    c.resign();
    expect(finished).toHaveLength(1);
  });

  it('graine sur 32 bits', () => {
    expect(newSeed(() => 0)).toBe(0);
    expect(newSeed(() => 0.999999999)).toBeLessThanOrEqual(0xffffffff);
  });
});
