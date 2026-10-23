/**
 * Historique local des parties (contrat C4), module pur : le stockage est injecté
 * (AsyncStorage dans l'appli, mémoire dans les tests). Les 50 dernières parties sont
 * gardées sur l'appareil, Dames et Ludo confondus, la plus récente d'abord.
 *
 * Les écrans 18 (fin de partie) et 19 (revoir) lisent d'abord ici, sinon le serveur
 * (`GET /v1/games/:id`, contrat C3).
 */
import type { MachineSettlementView, RatingChangeView } from '@kwatt/protocol';
import type { HouseRules } from '@kwatt/rules-ludo';
import { readJson, writeJson, type KeyValueStore } from '../../storage/kv';
import type { GameFamily, GameOutcome, SeatInfo } from './controller';

export const LOCAL_HISTORY_KEY = 'kwatt.games.history.v1';
export const LOCAL_HISTORY_LIMIT = 50;

/** Contexte de la partie : contre la machine, en salon, en ligue. */
export type LocalGameContext = 'machine' | 'room' | 'league';

/** Partie terminée, telle que l'appareil la garde. */
export interface LocalGame {
  id: string;
  family: GameFamily;
  /** Variante : dames10, dames8, ludo_classique… */
  variant: string;
  context?: LocalGameContext;
  seats: SeatInfo[];
  /** Sièges joués par cet appareil (pour « Toi »). */
  mySeats?: number[];
  /** Coups au format du contrat C2 (Dames : notation officielle ; Ludo : « lancer:pion »). */
  moves: string[];
  /** Ludo : règles maison de la partie (sans elles, la notation ne se rejoue pas). */
  house?: HouseRules;
  outcome: GameOutcome;
  /** Cauris réglés par le serveur (absent tant que le résultat attend le réseau). */
  settlement?: MachineSettlementView;
  /** Variation de force (absente si non classée, ou pas encore réglée). */
  rating?: RatingChangeView | null;
  /** Partie contre la machine : difficulté, série, pari… */
  machine?: { difficulty: string; mode: 'auto' | 'chosen'; bet: number; winStreak?: number; offline: boolean; pending?: boolean; rejected?: string };
  /** Carte gagnée renvoyée par le serveur (code d'objet). */
  card?: string | null;
  playedAt: string;
}

export interface GameHistory {
  saveLocalGame(game: LocalGame): Promise<void>;
  /** Met à jour une partie déjà gardée (règlement reçu du serveur). Sans effet si elle n'existe plus. */
  updateLocalGame(id: string, patch: Partial<Omit<LocalGame, 'id'>>): Promise<LocalGame | null>;
  getLocalGame(id: string): Promise<LocalGame | null>;
  listLocalGames(family?: GameFamily): Promise<LocalGame[]>;
  subscribe(listener: (games: readonly LocalGame[]) => void): () => void;
  clear(): Promise<void>;
}

function isLocalGame(v: unknown): v is LocalGame {
  const g = v as Partial<LocalGame> | null;
  return (
    !!g &&
    typeof g.id === 'string' &&
    (g.family === 'dames' || g.family === 'ludo') &&
    typeof g.variant === 'string' &&
    Array.isArray(g.moves) &&
    Array.isArray(g.seats) &&
    !!g.outcome &&
    typeof g.playedAt === 'string'
  );
}

export function createGameHistory(storage: KeyValueStore, key = LOCAL_HISTORY_KEY): GameHistory {
  let cache: LocalGame[] | null = null;
  // Les écritures se suivent : deux sauvegardes rapprochées ne s'écrasent pas.
  let chain: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(games: readonly LocalGame[]) => void>();

  async function load(): Promise<LocalGame[]> {
    if (cache) return cache;
    const raw = await readJson(storage, key);
    cache = Array.isArray(raw) ? raw.filter(isLocalGame) : [];
    return cache;
  }

  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  }

  async function persist(games: LocalGame[]): Promise<void> {
    cache = games;
    await writeJson(storage, key, games);
    for (const l of listeners) l([...games]);
  }

  return {
    saveLocalGame(game) {
      return serial(async () => {
        const games = (await load()).filter((g) => g.id !== game.id);
        games.unshift(game);
        await persist(games.slice(0, LOCAL_HISTORY_LIMIT));
      });
    },
    updateLocalGame(id, patch) {
      return serial(async () => {
        const games = [...(await load())];
        const i = games.findIndex((g) => g.id === id);
        if (i < 0) return null;
        const updated = { ...games[i]!, ...patch, id };
        games[i] = updated;
        await persist(games);
        return updated;
      });
    },
    async getLocalGame(id) {
      await chain;
      return (await load()).find((g) => g.id === id) ?? null;
    },
    async listLocalGames(family) {
      await chain;
      const games = await load();
      return family ? games.filter((g) => g.family === family) : [...games];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      return serial(() => persist([]));
    },
  };
}
