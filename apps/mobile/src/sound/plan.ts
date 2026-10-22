/**
 * Quels sons et quelles vibrations pour quels événements du plateau (planche
 * « Réf · Identité », SPEC §5) : balafon (déplacer), tam-tam (prise), nkul (ton tour),
 * mvet (victoire, dame). Module pur, testé par vitest.
 */
import type { Preferences, SoundPack } from '../preferences/preferences';

export type BoardEvent = 'move' | 'capture' | 'yourTurn' | 'victory' | 'promotion' | 'invalid';

/** Fichiers synthétisés par scripts/generate-sounds.mjs (assets/sounds). */
export type SoundId = 'balafon' | 'tamtam' | 'tamtamLight' | 'nkul' | 'mvet';

export type HapticKind = 'capture' | 'error';

const PACKS: Record<Exclude<SoundPack, 'silence'>, Record<BoardEvent, SoundId | null>> = {
  // Réglage par défaut : la répartition de la planche.
  balafon: { move: 'balafon', capture: 'tamtam', yourTurn: 'nkul', victory: 'mvet', promotion: 'mvet', invalid: null },
  // Réglage « Tam-tam » : tout en percussions, un coup léger pour déplacer.
  tamtam: { move: 'tamtamLight', capture: 'tamtam', yourTurn: 'nkul', victory: 'mvet', promotion: 'mvet', invalid: null },
};

export function soundFor(event: BoardEvent, pack: SoundPack): SoundId | null {
  return pack === 'silence' ? null : PACKS[pack][event];
}

/**
 * Vibration : à la prise et au coup refusé (planche Matrice : « le pion revient,
 * vibration courte »), seulement si le joueur l'a laissée activée.
 */
export function hapticFor(event: BoardEvent, prefs: Pick<Preferences, 'vibration'>): HapticKind | null {
  if (!prefs.vibration) return null;
  if (event === 'capture') return 'capture';
  if (event === 'invalid') return 'error';
  return null;
}
