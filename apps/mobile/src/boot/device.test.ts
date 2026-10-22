import { describe, expect, it } from 'vitest';
import { isTablet, isTabletSize } from './device';

describe('téléphone ou tablette', () => {
  it('se décide sur le plus petit côté de l’écran', () => {
    expect(isTabletSize(390, 844)).toBe(false);
    expect(isTabletSize(844, 390)).toBe(false);
    expect(isTabletSize(360, 640)).toBe(false);
    expect(isTabletSize(768, 1024)).toBe(true);
    expect(isTabletSize(1194, 834)).toBe(true);
  });

  it('préfère l’avis du système quand il le donne', () => {
    expect(isTablet(true, 390, 844)).toBe(true);
    expect(isTablet(false, 800, 1280)).toBe(false);
    expect(isTablet(null, 800, 1280)).toBe(true);
  });
});
