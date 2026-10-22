import { describe, expect, it } from 'vitest';
import { normalizeCodeSegment, normalizeIncomingPath, shareLinks } from './deepLinks';

describe('liens profonds', () => {
  it('ouvre un salon depuis kwatt://salon/CODE, code normalisé', () => {
    expect(normalizeIncomingPath('kwatt://salon/M4TK9Q')).toBe('/salon/M4TK9Q');
    expect(normalizeIncomingPath('kwatt://salon/m4t-k9q')).toBe('/salon/M4TK9Q');
    expect(normalizeIncomingPath('KWATT:///salon/m4tk9q')).toBe('/salon/M4TK9Q');
  });

  it('ouvre une ligue et une invitation d’ami', () => {
    expect(normalizeIncomingPath('kwatt://ligue/abc-def')).toBe('/ligue/ABCDEF');
    expect(normalizeIncomingPath('kwatt://ami/brice_237')).toBe('/ami/brice_237');
  });

  it('ramène le lien de partage du web vers le salon', () => {
    expect(normalizeIncomingPath('https://kwatt.example/s/m4tk9q')).toBe('/salon/M4TK9Q');
    expect(normalizeIncomingPath('/s/M4T-K9Q?ref=wa')).toBe('/salon/M4TK9Q?ref=wa');
  });

  it('comprend les liens d’Expo Go (exp://…/--/salon/CODE)', () => {
    expect(normalizeIncomingPath('exp://192.168.1.20:8081/--/salon/m4tk9q')).toBe('/salon/M4TK9Q');
  });

  it('laisse un code invalide tel quel (l’écran dira « code inconnu »)', () => {
    expect(normalizeIncomingPath('kwatt://salon/ABC')).toBe('/salon/ABC');
    expect(normalizeCodeSegment('M0TK9Q')).toBe('M0TK9Q');
    expect(normalizeCodeSegment('m4t%20k9q')).toBe('M4TK9Q');
  });

  it('rend les autres chemins sans les toucher', () => {
    expect(normalizeIncomingPath('kwatt://notifications')).toBe('/notifications');
    expect(normalizeIncomingPath('/ligue/ABCDEF/coupe')).toBe('/ligue/ABCDEF/coupe');
    expect(normalizeIncomingPath('kwatt://')).toBe('/');
    expect(normalizeIncomingPath('')).toBe('/');
  });

  it('fabrique les liens à partager', () => {
    expect(shareLinks('salon', 'M4TK9Q', 'kwatt.example')).toEqual({ app: 'kwatt://salon/M4TK9Q', web: 'https://kwatt.example/s/M4TK9Q' });
    expect(shareLinks('ligue', 'ABCDEF')).toEqual({ app: 'kwatt://ligue/ABCDEF', web: null });
  });
});
