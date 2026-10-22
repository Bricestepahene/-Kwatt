import { describe, expect, it } from 'vitest';
import {
  extractRoomCode,
  formatRoomCode,
  initialOf,
  isRoomCodeComplete,
  normalizeDigits,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  snap,
} from './logic';

describe('codes de salon (ABC-DEF, sans 0/O/1/I)', () => {
  it('a un alphabet de 32 caractères sans les signes ambigus', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    for (const ch of '0O1I') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
  });

  it('normalise la saisie', () => {
    expect(normalizeRoomCode('m4t-k9q')).toBe('M4TK9Q');
    expect(normalizeRoomCode(' M4T K9Q 77 ')).toBe('M4TK9Q');
    expect(normalizeRoomCode('O0I1ab')).toBe('AB');
  });

  it('affiche avec un tiret au milieu', () => {
    expect(formatRoomCode('M4TK9Q')).toBe('M4T-K9Q');
    expect(formatRoomCode('M4T')).toBe('M4T');
    expect(formatRoomCode('M4TK')).toBe('M4T-K');
    expect(isRoomCodeComplete('M4TK9Q')).toBe(true);
    expect(isRoomCodeComplete('M4TK9')).toBe(false);
  });

  it('retrouve le code dans un lien ou un texte collé', () => {
    expect(extractRoomCode('kwatt://salon/M4TK9Q')).toBe('M4TK9Q');
    expect(extractRoomCode('kwatt://ligue/ABCDEF')).toBe('ABCDEF');
    expect(extractRoomCode('https://kwatt.example/s/m4tk9q?x=1')).toBe('M4TK9Q');
    expect(extractRoomCode('M4T-K9Q')).toBe('M4TK9Q');
    expect(extractRoomCode('  m4tk9q ')).toBe('M4TK9Q');
    expect(extractRoomCode('Rejoins-moi !')).toBeNull();
    expect(extractRoomCode('M0TK9Q')).toBeNull(); // 0 interdit
  });
});

describe('autres saisies', () => {
  it('garde 6 chiffres pour le code reçu par e-mail', () => {
    expect(normalizeDigits('48 2-9a17')).toBe('482917');
    expect(normalizeDigits('12345678')).toBe('123456');
  });

  it('ramène le curseur sur le pas et dans les bornes', () => {
    expect(snap(0.73, 0, 1, 0.05)).toBe(0.75);
    expect(snap(-3, 0, 1, 0.05)).toBe(0);
    expect(snap(140, 0, 500, 50)).toBe(150);
    expect(snap(510, 0, 500, 50)).toBe(500);
  });

  it('prend l’initiale du pseudo', () => {
    expect(initialOf('brice_237')).toBe('B');
    expect(initialOf('  émile')).toBe('É');
    expect(initialOf('_237')).toBe('2');
    expect(initialOf('')).toBe('?');
    expect(initialOf(null)).toBe('?');
  });
});
