/**
 * Téléphone ou tablette (planche « Réf · Tailles d'écran ») : portrait imposé sur
 * téléphone, orientation libre sur tablette. Module pur, testé par vitest.
 */

/** Plus petit côté (en points) à partir duquel on considère une tablette. */
export const TABLET_MIN_SHORT_SIDE = 600;

/** Largeur à partir de laquelle une partie passe en mise en page tablette (écran 43, SPEC §5). */
export const TABLET_LAYOUT_MIN_WIDTH = 900;

export function isTabletSize(width: number, height: number): boolean {
  return Math.min(width, height) >= TABLET_MIN_SHORT_SIDE;
}

/**
 * Tablette si le système le dit (expo-device), sinon d'après la taille de l'écran.
 * `systemSaysTablet` : `null` quand le système ne sait pas.
 */
export function isTablet(systemSaysTablet: boolean | null, width: number, height: number): boolean {
  return systemSaysTablet ?? isTabletSize(width, height);
}
