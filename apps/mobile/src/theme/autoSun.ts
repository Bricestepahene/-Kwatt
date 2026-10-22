/**
 * Réglage « Automatique » (SPEC §5, D-04) : Plein soleil quand le capteur de lumière
 * dépasse 10 000 lux pendant 3 s (Android) ; ailleurs, on suit le mode clair/sombre du
 * système. Module pur, testé par vitest.
 */
import type { ThemeName } from '@kwatt/design';
import type { ThemeSetting } from '../preferences/preferences';

export const SUN_LUX_THRESHOLD = 10_000;
export const SUN_HOLD_MS = 3_000;

export interface AutoSunDetector {
  /** Nouvelle mesure ; renvoie l'état courant (vrai = Plein soleil). */
  update(lux: number, nowMs: number): boolean;
  readonly isSun: boolean;
}

/**
 * Bascule seulement si la lumière reste du même côté du seuil pendant `holdMs`
 * (dans les deux sens), pour ne pas clignoter à l'ombre d'un passant.
 */
export function createAutoSunDetector(
  initialSun = false,
  threshold = SUN_LUX_THRESHOLD,
  holdMs = SUN_HOLD_MS,
): AutoSunDetector {
  let isSun = initialSun;
  let candidateSince: number | null = null;
  return {
    get isSun() {
      return isSun;
    },
    update(lux, nowMs) {
      const bright = Number.isFinite(lux) && lux > threshold;
      if (bright === isSun) {
        candidateSince = null;
        return isSun;
      }
      if (candidateSince === null) candidateSince = nowMs;
      if (nowMs - candidateSince >= holdMs) {
        isSun = bright;
        candidateSince = null;
      }
      return isSun;
    },
  };
}

export interface ThemeEnvironment {
  /** Le capteur de lumière est utilisable (Android avec capteur). */
  sensorAvailable: boolean;
  /** État du détecteur de lumière. */
  sensorSun: boolean;
  /** Mode du système : 'light', 'dark' ou inconnu. */
  systemScheme: 'light' | 'dark' | null | undefined;
}

/** Thème affiché selon le réglage du joueur et l'environnement. */
export function resolveThemeName(setting: ThemeSetting, env: ThemeEnvironment): ThemeName {
  if (setting === 'night') return 'night';
  if (setting === 'sun') return 'pleinSoleil';
  if (env.sensorAvailable) return env.sensorSun ? 'pleinSoleil' : 'night';
  return env.systemScheme === 'light' ? 'pleinSoleil' : 'night';
}
