/**
 * Stockage clé → texte, asynchrone. Les modules purs (préférences, session, file hors
 * ligne) reçoivent cette interface : AsyncStorage ou SecureStore dans l'appli, une
 * mémoire dans les tests.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Stockage en mémoire (tests, et repli si le stockage de l'appareil échoue). */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return data.get(key) ?? null;
    },
    async setItem(key, value) {
      data.set(key, value);
    },
    async removeItem(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data);
    },
  };
}

/** Lit un JSON ; `null` si absent ou illisible (stockage abîmé : on repart des valeurs par défaut). */
export async function readJson(store: KeyValueStore, key: string): Promise<unknown> {
  try {
    const raw = await store.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function writeJson(store: KeyValueStore, key: string, value: unknown): Promise<void> {
  await store.setItem(key, JSON.stringify(value));
}

/** Clés de stockage de l'appli (préfixe commun « kwatt. »). */
export const STORAGE_KEYS = {
  preferences: 'kwatt.preferences.v1',
  session: 'kwatt.session.v1',
  installId: 'kwatt.installId',
  offlineQueue: 'kwatt.offlineQueue.v1',
} as const;
