/**
 * Variante choisie dans l'espace Dames (10×10 ou 8×8), gardée sur l'appareil.
 */
import type { Variant } from '@kwatt/rules-dames';
import { useEffect, useState } from 'react';
import { localStorage } from '../../storage/deviceStorage';

const KEY = 'kwatt.dames.variant.v1';
let current: Variant = 'dames10';
let loaded = false;
const listeners = new Set<(v: Variant) => void>();

export function isDamesVariant(v: unknown): v is Variant {
  return v === 'dames10' || v === 'dames8';
}

export function setDamesVariant(v: Variant): void {
  current = v;
  loaded = true;
  void localStorage.setItem(KEY, v).catch(() => undefined);
  for (const l of listeners) l(v);
}

export function useDamesVariant(): [Variant, (v: Variant) => void] {
  const [v, setV] = useState<Variant>(current);
  useEffect(() => {
    listeners.add(setV);
    if (!loaded) {
      void localStorage
        .getItem(KEY)
        .then((stored) => {
          if (!loaded && isDamesVariant(stored)) {
            current = stored;
            for (const l of listeners) l(stored);
          }
          loaded = true;
        })
        .catch(() => undefined);
    }
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return [v, setDamesVariant];
}
