/**
 * File hors ligne persistante : ce qui doit partir au serveur quand le réseau revient
 * (ex. résultat d'une partie contre la machine jouée sans réseau, SPEC §7 / D-08).
 * L'ordre est gardé : une action en échec temporaire bloque les suivantes.
 * Module pur : stockage, horloge et identifiants injectés ; testé par vitest.
 */
import { readJson, STORAGE_KEYS, writeJson, type KeyValueStore } from '../storage/kv';

export interface QueuedAction<P = unknown> {
  id: string;
  /** Type d'action, ex. « machine.result » : chaque équipe enregistre son envoi. */
  kind: string;
  payload: P;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

/**
 * Résultat d'un envoi :
 * - `done`  : accepté (ou déjà reçu : la clé d'idempotence protège des doublons) ;
 * - `retry` : échec temporaire (réseau, serveur), on réessaiera plus tard ;
 * - `drop`  : refusé pour de bon (invalide, trop vieux) : retiré de la file ;
 * - `later` : pas encore envoyable (module pas chargé) : on s'arrête sans compter d'essai.
 */
export type SendOutcome = 'done' | 'retry' | 'drop' | 'later';

export type Sender = (action: QueuedAction) => Promise<SendOutcome>;

export interface FlushReport {
  sent: number;
  dropped: number;
  remaining: number;
}

export interface OfflineQueue {
  load(): Promise<void>;
  enqueue<P>(kind: string, payload: P): Promise<QueuedAction<P>>;
  list(): readonly QueuedAction[];
  size(): number;
  /** Envoie dans l'ordre ; un seul envoi à la fois (les appels simultanés partagent le même). */
  flush(send: Sender): Promise<FlushReport>;
  subscribe(listener: (actions: readonly QueuedAction[]) => void): () => void;
  clear(): Promise<void>;
}

export interface OfflineQueueOptions {
  storage: KeyValueStore;
  now?: () => number;
  newId: () => string;
  key?: string;
  /** Au-delà, une action toujours en échec est abandonnée. */
  maxAttempts?: number;
}

function isAction(value: unknown): value is QueuedAction {
  const v = value as Partial<QueuedAction> | null;
  return !!v && typeof v.id === 'string' && typeof v.kind === 'string' && typeof v.createdAt === 'number' && typeof v.attempts === 'number';
}

export function createOfflineQueue(options: OfflineQueueOptions): OfflineQueue {
  const key = options.key ?? STORAGE_KEYS.offlineQueue;
  const now = options.now ?? Date.now;
  const maxAttempts = options.maxAttempts ?? 20;
  let actions: QueuedAction[] = [];
  let loaded: Promise<void> | null = null;
  let flushing: Promise<FlushReport> | null = null;
  const listeners = new Set<(a: readonly QueuedAction[]) => void>();

  const notify = () => {
    const snapshot = [...actions];
    for (const listener of listeners) listener(snapshot);
  };
  const save = async () => {
    await writeJson(options.storage, key, actions);
    notify();
  };

  function load(): Promise<void> {
    loaded ??= (async () => {
      const raw = await readJson(options.storage, key);
      const stored = Array.isArray(raw) ? raw.filter(isAction) : [];
      // Garde ce qui a pu être ajouté avant la fin du chargement.
      const known = new Set(stored.map((a) => a.id));
      actions = [...stored, ...actions.filter((a) => !known.has(a.id))];
      notify();
    })();
    return loaded;
  }

  async function runFlush(send: Sender): Promise<FlushReport> {
    await load();
    let sent = 0;
    let dropped = 0;
    while (actions.length > 0) {
      const action = actions[0]!;
      let outcome: SendOutcome;
      let error: string | undefined;
      try {
        outcome = await send(action);
      } catch (e) {
        outcome = 'retry';
        error = e instanceof Error ? e.message : String(e);
      }
      if (outcome === 'later') break;
      if (outcome === 'retry') {
        const attempts = action.attempts + 1;
        if (attempts >= maxAttempts) {
          actions = actions.slice(1);
          dropped += 1;
          await save();
          continue;
        }
        actions = [{ ...action, attempts, ...(error ? { lastError: error } : {}) }, ...actions.slice(1)];
        await save();
        break;
      }
      actions = actions.slice(1);
      if (outcome === 'done') sent += 1;
      else dropped += 1;
      await save();
    }
    return { sent, dropped, remaining: actions.length };
  }

  return {
    load,
    async enqueue<P>(kind: string, payload: P) {
      await load();
      const action: QueuedAction<P> = { id: options.newId(), kind, payload, createdAt: now(), attempts: 0 };
      actions = [...actions, action];
      await save();
      return action;
    },
    list: () => actions,
    size: () => actions.length,
    flush(send) {
      flushing ??= runFlush(send).finally(() => {
        flushing = null;
      });
      return flushing;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async clear() {
      actions = [];
      await save();
    },
  };
}
