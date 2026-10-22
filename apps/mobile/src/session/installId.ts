/**
 * Identifiant d'installation (SPEC §6, table `devices`) : tiré une fois, gardé sur
 * l'appareil, envoyé au serveur (invité, mises : jamais deux comptes du même appareil).
 * Module pur : stockage et tirage injectés.
 */
import { STORAGE_KEYS, type KeyValueStore } from '../storage/kv';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createInstallIdProvider(storage: KeyValueStore, randomUUID: () => string): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= (async () => {
      const saved = await storage.getItem(STORAGE_KEYS.installId).catch(() => null);
      if (saved && UUID.test(saved)) return saved;
      const fresh = randomUUID();
      await storage.setItem(STORAGE_KEYS.installId, fresh).catch(() => undefined);
      return fresh;
    })();
    return pending;
  };
}
