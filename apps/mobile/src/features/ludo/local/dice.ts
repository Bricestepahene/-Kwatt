/**
 * Lancers d'une partie locale (hors connexion) : tirés sur l'appareil par
 * crypto.getRandomValues (pas de pari hors ligne, D-08). En ligne, le serveur tire le dé
 * avec @kwatt/fair-dice ; ce module ne sert jamais pour une partie distante.
 *
 * Module pur : la source d'octets est injectée (expo-crypto dans l'appli, suite fixe en test).
 */
import { COWRIE_VALUES, cowrieValue, type ThrowKind } from '@kwatt/rules-ludo';

export type ByteSource = (count: number) => Uint8Array;

export interface ThrowResult {
  value: number;
  /** Cauris : ouverture vers le ciel (vrai) ou dos (faux), pour le dessin. */
  shells?: boolean[];
}

/** Dé à 6 faces sans biais (rejet des octets ≥ 252). */
export function rollDie(bytes: ByteSource): number {
  for (;;) {
    const b = bytes(1)[0]!;
    if (b < 252) return (b % 6) + 1;
  }
}

/** 6 cauris : chaque coquillage retombe ouverture vers le ciel une fois sur deux. */
export function throwCowries(bytes: ByteSource): ThrowResult {
  const b = bytes(1)[0]!;
  const shells = Array.from({ length: 6 }, (_, i) => ((b >> i) & 1) === 1);
  const up = shells.filter(Boolean).length;
  return { value: cowrieValue(up), shells };
}

export function throwFor(kind: ThrowKind, bytes: ByteSource): ThrowResult {
  return kind === 'cowries' ? throwCowries(bytes) : { value: rollDie(bytes) };
}

/** Coquillages à dessiner pour une valeur connue (lancer de la machine, partie distante) : les ouvertures d'abord. */
export function shellsForValue(value: number): boolean[] {
  const up = COWRIE_VALUES.indexOf(value);
  const n = up < 0 ? 0 : up;
  return Array.from({ length: 6 }, (_, i) => i < n);
}
