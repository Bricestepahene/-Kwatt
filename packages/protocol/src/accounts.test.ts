import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  QuarterIdSchema,
  QuarterSearchQuerySchema,
  ROOM_CODE_PATTERN,
  RoomPreviewSchema,
  isValidDisplayNameFormat,
  normalizeDisplayName,
} from './index.js';

describe('nom de partie (invité)', () => {
  it('2 à 20 caractères : lettres, chiffres, espaces, « . _ - \' »', () => {
    for (const ok of ['Jo', 'Tonton Paul', 'Mamá Ngo-Bassa', "Tata O'dile", 'Brice 237', 'J.-P.', 'x'.repeat(20)]) {
      expect(isValidDisplayNameFormat(ok), ok).toBe(true);
    }
    for (const ko of ['J', '', '   ', 'x'.repeat(21), 'Paul!', '-Paul', 'Paul-', '<b>Paul</b>']) {
      expect(isValidDisplayNameFormat(ko), ko).toBe(false);
    }
  });

  it('retire les espaces en trop', () => {
    expect(normalizeDisplayName('  Tonton   Paul ')).toBe('Tonton Paul');
    expect(normalizeDisplayName('Paul\nJean')).toBe('Paul Jean');
    expect(isValidDisplayNameFormat('  Tonton   Paul ')).toBe(true);
  });
});

describe('quartiers', () => {
  it('identifiants stables en minuscules', () => {
    expect(QuarterIdSchema.safeParse('cm-douala-deido').success).toBe(true);
    expect(QuarterIdSchema.safeParse('fr-paris').success).toBe(true);
    expect(QuarterIdSchema.safeParse('CM-douala').success).toBe(false);
    expect(QuarterIdSchema.safeParse('cm').success).toBe(false);
    expect(QuarterIdSchema.safeParse('cm-douala-déïdo').success).toBe(false);
  });

  it('recherche : 20 résultats par défaut, 50 au plus', () => {
    expect(QuarterSearchQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(QuarterSearchQuerySchema.parse({ q: ' deido ', limit: '5' })).toEqual({ q: 'deido', limit: 5 });
    expect(QuarterSearchQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});

describe('salons (contrat avec Parties en ligne)', () => {
  it('codes de 6 caractères sans 0, O, 1, I', () => {
    expect(ROOM_CODE_PATTERN.test('M4TK9Q')).toBe(true);
    expect(ROOM_CODE_PATTERN.test('M4T-K9Q')).toBe(false);
    expect(ROOM_CODE_PATTERN.test('MOTK9Q')).toBe(false);
    expect(ROOM_CODE_PATTERN.test('M1TK9Q')).toBe(false);
  });

  it('aperçu d\'un salon trouvé', () => {
    const preview = {
      code: 'M4TK9Q',
      game: 'ludo',
      variant: 'ludo_classique',
      name: 'Salon Famille Ndjock',
      host: { userId: '00000000-0000-4000-8000-000000000001', pseudo: 'brice_237' },
      seats: 4,
      seated: [{ userId: '00000000-0000-4000-8000-000000000001', pseudo: 'brice_237', avatar: null }],
      queueLength: 1,
      format: 'roi',
      stake: 0,
      status: 'open',
    };
    expect(RoomPreviewSchema.parse(preview)).toEqual(preview);
    expect(RoomPreviewSchema.safeParse({ ...preview, status: 'waiting' }).success).toBe(false);
  });

  it('codes d\'erreur partagés', () => {
    for (const code of ['room.not_found', 'room.full', 'room.closed', 'quarter.not_found', 'quarter.change_too_soon']) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});
