import { describe, expect, it } from 'vitest';
import { memoryStore } from '../../storage/kv';
import { LOCAL_HISTORY_LIMIT, createGameHistory, type LocalGame } from './historyStore';

const game = (id: string, family: LocalGame['family'] = 'dames'): LocalGame => ({
  id,
  family,
  variant: family === 'dames' ? 'dames10' : 'ludo_classique',
  seats: [
    { seat: 0, userId: 'u1', name: 'Brice' },
    { seat: 1, userId: null, name: 'machine', machine: { difficulty: 'facile' } },
  ],
  moves: ['32-28'],
  outcome: { places: { 0: 1, 1: 2 }, draw: false, reason: 'no_moves' },
  playedAt: '2026-10-22T10:00:00.000Z',
});

describe('historique local (C4)', () => {
  it('garde la plus récente d’abord, remplace une partie déjà gardée, filtre par jeu', async () => {
    const h = createGameHistory(memoryStore());
    await h.saveLocalGame(game('a'));
    await h.saveLocalGame(game('b', 'ludo'));
    await h.saveLocalGame({ ...game('a'), moves: ['32-28', '19-23'] });
    expect((await h.listLocalGames()).map((g) => g.id)).toEqual(['a', 'b']);
    expect((await h.listLocalGames('ludo')).map((g) => g.id)).toEqual(['b']);
    expect((await h.getLocalGame('a'))?.moves).toHaveLength(2);
    expect(await h.getLocalGame('zz')).toBeNull();
  });

  it('ne garde que les 50 dernières et relit le stockage', async () => {
    const store = memoryStore();
    const h = createGameHistory(store);
    for (let i = 0; i < LOCAL_HISTORY_LIMIT + 5; i++) await h.saveLocalGame(game(`g${i}`));
    const again = createGameHistory(store);
    const all = await again.listLocalGames();
    expect(all).toHaveLength(LOCAL_HISTORY_LIMIT);
    expect(all[0]!.id).toBe(`g${LOCAL_HISTORY_LIMIT + 4}`);
  });

  it('met à jour le règlement reçu plus tard et prévient les écrans', async () => {
    const h = createGameHistory(memoryStore());
    await h.saveLocalGame(game('a'));
    const seen: number[] = [];
    h.subscribe((games) => seen.push(games.length));
    const updated = await h.updateLocalGame('a', {
      settlement: { net: 25, base: 25, participation: 0, betNet: 0, streakBonus: false, counted: true },
    });
    expect(updated?.settlement?.net).toBe(25);
    expect(seen).toEqual([1]);
    expect(await h.updateLocalGame('absent', {})).toBeNull();
  });

  it('ignore un stockage abîmé', async () => {
    const h = createGameHistory(memoryStore({ 'kwatt.games.history.v1': '[{"id":1},"x"]' }));
    expect(await h.listLocalGames()).toEqual([]);
  });
});
