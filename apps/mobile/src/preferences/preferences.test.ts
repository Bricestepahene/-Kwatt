import { describe, expect, it } from 'vitest';
import { memoryStore, STORAGE_KEYS } from '../storage/kv';
import { createPreferencesStore, DEFAULT_PREFERENCES, sanitizePreferences } from './preferences';

describe('préférences', () => {
  it('a les valeurs par défaut de la maquette et de la SPEC', () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({
      soundPack: 'balafon',
      vibration: true,
      theme: 'night',
      boardNumbers: false,
      autoPlaySingleMove: true,
      language: null,
      lastSpace: 'dames',
    });
  });

  it('répare des préférences abîmées champ par champ', () => {
    const prefs = sanitizePreferences({
      soundPack: 'kora',
      volume: 3,
      vibration: 'oui',
      theme: 'sun',
      diceAnimation: 'fast',
      notifications: { yourTurn: false, roomInvites: 'x' },
      language: 'de',
    });
    expect(prefs.soundPack).toBe('balafon');
    expect(prefs.volume).toBe(1);
    expect(prefs.vibration).toBe(true);
    expect(prefs.theme).toBe('sun');
    expect(prefs.diceAnimation).toBe('fast');
    expect(prefs.notifications).toEqual({ yourTurn: false, roomInvites: true, leagueMatches: true });
    expect(prefs.language).toBeNull();
    expect(sanitizePreferences(null)).toEqual(sanitizePreferences(DEFAULT_PREFERENCES));
  });

  it('se recharge depuis l’appareil et enregistre chaque changement', async () => {
    const storage = memoryStore({ [STORAGE_KEYS.preferences]: JSON.stringify({ theme: 'auto', language: 'en' }) });
    const store = createPreferencesStore(storage);
    expect(store.getState().hydrated).toBe(false);
    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().prefs.theme).toBe('auto');
    expect(store.getState().prefs.language).toBe('en');

    store.getState().update({ soundPack: 'silence', notifications: { leagueMatches: false } });
    await Promise.resolve();
    const saved = JSON.parse(storage.dump()[STORAGE_KEYS.preferences]!);
    expect(saved.soundPack).toBe('silence');
    expect(saved.notifications).toEqual({ yourTurn: true, roomInvites: true, leagueMatches: false });
    expect(saved.theme).toBe('auto');
  });

  it('repart des valeurs par défaut si le stockage est illisible', async () => {
    const store = createPreferencesStore(memoryStore({ [STORAGE_KEYS.preferences]: '{pas du json' }));
    await store.getState().hydrate();
    expect(store.getState().prefs).toEqual(sanitizePreferences(DEFAULT_PREFERENCES));
  });
});
