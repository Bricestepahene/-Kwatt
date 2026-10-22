import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hapticFor, soundFor, type BoardEvent, type SoundId } from './plan';
import { SOUND_FILES } from './files';

describe('sons du plateau', () => {
  it('suit la répartition de la planche avec le balafon', () => {
    expect(soundFor('move', 'balafon')).toBe('balafon');
    expect(soundFor('capture', 'balafon')).toBe('tamtam');
    expect(soundFor('yourTurn', 'balafon')).toBe('nkul');
    expect(soundFor('victory', 'balafon')).toBe('mvet');
    expect(soundFor('promotion', 'balafon')).toBe('mvet');
  });

  it('joue tout en percussions avec le tam-tam', () => {
    expect(soundFor('move', 'tamtam')).toBe('tamtamLight');
    expect(soundFor('capture', 'tamtam')).toBe('tamtam');
  });

  it('se tait en mode Silence', () => {
    const events: BoardEvent[] = ['move', 'capture', 'yourTurn', 'victory', 'promotion', 'invalid'];
    expect(events.map((e) => soundFor(e, 'silence'))).toEqual(events.map(() => null));
  });

  it('vibre à la prise et au coup refusé, si la vibration est activée', () => {
    expect(hapticFor('capture', { vibration: true })).toBe('capture');
    expect(hapticFor('invalid', { vibration: true })).toBe('error');
    expect(hapticFor('move', { vibration: true })).toBeNull();
    expect(hapticFor('capture', { vibration: false })).toBeNull();
  });

  it('chaque son a son fichier synthétisé dans assets/sounds', () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/sounds');
    const ids: SoundId[] = ['balafon', 'tamtam', 'tamtamLight', 'nkul', 'mvet'];
    for (const id of ids) {
      expect(SOUND_FILES[id], id).toMatch(/\.wav$/);
      expect(existsSync(path.join(dir, SOUND_FILES[id])), SOUND_FILES[id]).toBe(true);
    }
  });
});
