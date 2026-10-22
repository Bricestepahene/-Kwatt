import { describe, expect, it } from 'vitest';
import { createAutoSunDetector, resolveThemeName } from './autoSun';

describe('Plein soleil automatique', () => {
  it('passe en Plein soleil après 3 s au-dessus de 10 000 lux', () => {
    const d = createAutoSunDetector();
    expect(d.update(12_000, 0)).toBe(false);
    expect(d.update(15_000, 2_999)).toBe(false);
    expect(d.update(15_000, 3_000)).toBe(true);
  });

  it('ne bascule pas sur un éclat bref', () => {
    const d = createAutoSunDetector();
    d.update(20_000, 0);
    d.update(20_000, 2_000);
    d.update(800, 2_500); // nuage : on repart de zéro
    expect(d.update(20_000, 3_500)).toBe(false);
    expect(d.update(20_000, 6_499)).toBe(false);
    expect(d.update(20_000, 6_500)).toBe(true);
  });

  it('revient en Nuit après 3 s à l’ombre', () => {
    const d = createAutoSunDetector(true);
    expect(d.update(300, 0)).toBe(true);
    expect(d.update(300, 3_000)).toBe(false);
  });

  it('ignore une mesure invalide comme de la lumière faible', () => {
    const d = createAutoSunDetector(true);
    d.update(Number.NaN, 0);
    expect(d.update(Number.NaN, 3_000)).toBe(false);
  });
});

describe('choix du thème', () => {
  const env = { sensorAvailable: false, sensorSun: false, systemScheme: 'dark' as const };

  it('respecte Nuit et Plein soleil forcés', () => {
    expect(resolveThemeName('night', { ...env, systemScheme: 'light' })).toBe('night');
    expect(resolveThemeName('sun', env)).toBe('pleinSoleil');
  });

  it('Automatique : capteur sur Android, sinon mode du système', () => {
    expect(resolveThemeName('auto', { sensorAvailable: true, sensorSun: true, systemScheme: 'dark' })).toBe('pleinSoleil');
    expect(resolveThemeName('auto', { sensorAvailable: true, sensorSun: false, systemScheme: 'light' })).toBe('night');
    expect(resolveThemeName('auto', { ...env, systemScheme: 'light' })).toBe('pleinSoleil');
    expect(resolveThemeName('auto', { ...env, systemScheme: null })).toBe('night');
  });
});
