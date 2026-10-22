/**
 * File hors ligne de l'appli : chaque fonctionnalité enregistre l'envoi de ses actions,
 * la file se vide toute seule au retour du réseau (et au démarrage).
 *
 *   registerOfflineSender('machine.result', async (action) => {
 *     await api.post('/v1/machine/results', action.payload, { headers: { 'Idempotency-Key': action.id } });
 *     return 'done';
 *   });
 *   await offlineQueue.enqueue('machine.result', { … });
 */
import { randomUUID } from 'expo-crypto';
import { useEffect, useState } from 'react';
import { isApiError } from '../api/errors';
import { sessionStore } from '../session';
import { localStorage } from '../storage/deviceStorage';
import { networkStore } from './network';
import { createOfflineQueue, type QueuedAction, type SendOutcome } from './queue';

export * from './queue';
export { networkStore, startNetworkMonitoring, useIsOffline, useNetwork, isOnlineState } from './network';

export const offlineQueue = createOfflineQueue({ storage: localStorage, newId: randomUUID });

type OfflineSender = (action: QueuedAction) => Promise<SendOutcome>;
const senders = new Map<string, OfflineSender>();

/** Enregistre l'envoi d'un type d'action (l'`id` de l'action sert de clé d'idempotence). */
export function registerOfflineSender(kind: string, sender: OfflineSender): () => void {
  senders.set(kind, sender);
  return () => senders.delete(kind);
}

/** Envoie la file si on a du réseau et une session. */
export async function flushOfflineQueue() {
  if (networkStore.getState().isOnline === false) return null;
  if (sessionStore.getState().status === 'signedOut' || sessionStore.getState().status === 'loading') return null;
  return offlineQueue.flush(async (action) => {
    const sender = senders.get(action.kind);
    // Pas encore d'envoi pour ce type (module pas chargé) : on garde l'action pour plus tard.
    if (!sender) return 'later';
    try {
      return await sender(action);
    } catch (error) {
      // Refus net du serveur (4xx) : inutile de réessayer ; sinon on réessaiera.
      if (isApiError(error) && !error.isTransient) return 'drop';
      throw error;
    }
  });
}

let started = false;

/** Vide la file au démarrage, au retour du réseau et à l'ouverture d'une session. */
export function startOfflineSync(): () => void {
  if (started) return () => undefined;
  started = true;
  void offlineQueue.load().then(flushOfflineQueue);
  const offNetwork = networkStore.subscribe((s, prev) => {
    if (s.isOnline && prev.isOnline === false) void flushOfflineQueue();
  });
  const offSession = sessionStore.subscribe((s, prev) => {
    if (s.status !== prev.status) void flushOfflineQueue();
  });
  return () => {
    started = false;
    offNetwork();
    offSession();
  };
}

/** Nombre d'actions en attente d'envoi. */
export function usePendingOfflineCount(): number {
  const [count, setCount] = useState(offlineQueue.size());
  useEffect(() => offlineQueue.subscribe((actions) => setCount(actions.length)), []);
  return count;
}
