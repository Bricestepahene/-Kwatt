/**
 * Dernières données connues, gardées sur l'appareil (planche Matrice, « Profil, médailles ·
 * hors connexion : données locales »). L'écran les montre, datées, quand le serveur est
 * injoignable ; elles sont remplacées dès que de nouvelles données arrivent.
 */
import { useEffect, useState } from 'react';
import { localStorage } from '../../storage/deviceStorage';
import { readJson, writeJson } from '../../storage/kv';

export interface Snapshot<T> {
  data: T;
  savedAt: number;
}

const PREFIX = 'kwatt.snapshot.v1.';

function isSnapshot<T>(value: unknown): value is Snapshot<T> {
  return typeof value === 'object' && value !== null && 'data' in value && typeof (value as { savedAt?: unknown }).savedAt === 'number';
}

/** Lit la copie locale de `key` et la remplace par `data` dès que `data` change. */
export function useLocalSnapshot<T>(key: string | null, data: T | undefined): Snapshot<T> | null {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    void readJson(localStorage, PREFIX + key).then((value) => {
      if (alive && isSnapshot<T>(value)) setSnapshot((current) => current ?? value);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  useEffect(() => {
    if (!key || data === undefined) return;
    const next = { data, savedAt: Date.now() };
    setSnapshot(next);
    void writeJson(localStorage, PREFIX + key, next).catch(() => undefined);
  }, [key, data]);

  return snapshot;
}
