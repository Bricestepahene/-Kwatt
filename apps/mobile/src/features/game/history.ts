/**
 * Historique local des parties (contrat C4) : AsyncStorage, 50 dernières parties.
 *
 *   await saveLocalGame({ id, family, variant, seats, moves, outcome, settlement?, rating?, playedAt });
 *   const game = await getLocalGame(id);
 *   const games = await listLocalGames('ludo');
 *   const game = useLocalGame(id);   // se met à jour quand le règlement arrive
 */
import { useEffect, useState } from 'react';
import { localStorage } from '../../storage/deviceStorage';
import { createGameHistory, type LocalGame } from './historyStore';

export * from './historyStore';

export const gameHistory = createGameHistory(localStorage);

export const saveLocalGame = (game: LocalGame) => gameHistory.saveLocalGame(game);
export const updateLocalGame = (id: string, patch: Partial<Omit<LocalGame, 'id'>>) => gameHistory.updateLocalGame(id, patch);
export const getLocalGame = (id: string) => gameHistory.getLocalGame(id);
export const listLocalGames = (family?: LocalGame['family']) => gameHistory.listLocalGames(family);

/** Partie locale (ou `null` si absente, `undefined` pendant la lecture), suivie en direct. */
export function useLocalGame(id: string | undefined): LocalGame | null | undefined {
  const [game, setGame] = useState<LocalGame | null | undefined>(undefined);
  useEffect(() => {
    if (!id) {
      setGame(null);
      return;
    }
    let alive = true;
    void gameHistory.getLocalGame(id).then((g) => {
      if (alive) setGame(g);
    });
    const off = gameHistory.subscribe((games) => {
      if (alive) setGame(games.find((g) => g.id === id) ?? null);
    });
    return () => {
      alive = false;
      off();
    };
  }, [id]);
  return game;
}
