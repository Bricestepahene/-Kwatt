/** Noms des fichiers de sons (assets/sounds), écrits par scripts/generate-sounds.mjs. */
import type { SoundId } from './plan';

export const SOUND_FILES: Record<SoundId, string> = {
  balafon: 'balafon.wav',
  tamtam: 'tamtam.wav',
  tamtamLight: 'tamtam-leger.wav',
  nkul: 'nkul.wav',
  mvet: 'mvet.wav',
};
