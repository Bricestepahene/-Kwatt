import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  ClientEnvelopeSchema,
  DeviceSchema,
  ERROR_CODES,
  EXPO_PUSH_TOKEN_PATTERN,
  EmailSchema,
  MarkReadRequestSchema,
  PaginationQuerySchema,
  PingMessageSchema,
  RegisterRequestSchema,
  SettingsSchema,
  isErrorCode,
  isValidPseudoFormat,
  notificationCategory,
} from './index.js';

describe('codes d\'erreur', () => {
  // module.nom, ou module.groupe.nom pour les codes repris tels quels de @kwatt/rules-ludo (ludo.setup.barrier_lock).
  it('sont uniques et de la forme module.nom', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) expect(code).toMatch(/^[a-z]+(\.[a-z_]+){1,2}$/);
  });

  it('se reconnaissent', () => {
    expect(isErrorCode('auth.invalid_credentials')).toBe(true);
    expect(isErrorCode('nope.nope')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });

  it('la forme d\'erreur accepte un code inconnu (appli plus ancienne que le serveur)', () => {
    expect(ApiErrorSchema.safeParse({ error: { code: 'future.code', params: { n: 1 } } }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: 'x' } }).success).toBe(false);
  });
});

describe('schémas REST', () => {
  it('normalise l\'e-mail', () => {
    expect(EmailSchema.parse('  Brice@Example.COM ')).toBe('brice@example.com');
    expect(EmailSchema.safeParse('pas-un-email').success).toBe(false);
  });

  it('contrôle le format du pseudo', () => {
    expect(isValidPseudoFormat('brice_237')).toBe(true);
    expect(isValidPseudoFormat('ab')).toBe(false);
    expect(isValidPseudoFormat('a'.repeat(21))).toBe(false);
    expect(isValidPseudoFormat('bri ce')).toBe(false);
    expect(isValidPseudoFormat('brïce')).toBe(false);
  });

  it('exige un appareil à l\'inscription', () => {
    const base = { pseudo: 'brice', email: 'b@example.com', password: 'motdepasse', birthYear: 1990, acceptTerms: true };
    expect(RegisterRequestSchema.safeParse(base).success).toBe(false);
    expect(
      RegisterRequestSchema.safeParse({ ...base, device: { installId: 'install-123456', platform: 'android' } }).success,
    ).toBe(true);
    expect(DeviceSchema.safeParse({ installId: 'a b', platform: 'android' }).success).toBe(false);
  });

  it('borne la pagination', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(PaginationQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
    expect(PaginationQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('limite les réglages à 50 clés', () => {
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, true]));
    expect(SettingsSchema.safeParse(many).success).toBe(false);
    expect(SettingsSchema.safeParse({ sound: 'balafon', volume: 0.8 }).success).toBe(true);
  });

  it('marquer comme lues exige des identifiants ou « toutes »', () => {
    expect(MarkReadRequestSchema.safeParse({}).success).toBe(false);
    expect(MarkReadRequestSchema.safeParse({ all: true }).success).toBe(true);
  });

  it('reconnaît les jetons push Expo', () => {
    expect(EXPO_PUSH_TOKEN_PATTERN.test('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(EXPO_PUSH_TOKEN_PATTERN.test('ExpoPushToken[abcdefghijklmnop]')).toBe(true);
    expect(EXPO_PUSH_TOKEN_PATTERN.test('token')).toBe(false);
  });
});

describe('notifications', () => {
  it('déduisent la catégorie du préfixe', () => {
    expect(notificationCategory('turn.your_turn')).toBe('turn');
    expect(notificationCategory('invites.room')).toBe('invites');
    expect(notificationCategory('league.match_soon')).toBe('league');
    expect(notificationCategory('quest.completed')).toBe('general');
  });
});

describe('enveloppe WebSocket', () => {
  it('accepte les données en plus de t et id', () => {
    expect(ClientEnvelopeSchema.parse({ t: 'room.join', id: '1', code: 'ABCDEF' })).toEqual({
      t: 'room.join',
      id: '1',
      code: 'ABCDEF',
    });
    expect(ClientEnvelopeSchema.safeParse({ id: '1' }).success).toBe(false);
    expect(ClientEnvelopeSchema.safeParse({ t: 'Room Join' }).success).toBe(false);
  });

  it('valide un message typé', () => {
    expect(PingMessageSchema.safeParse({ t: 'ping', id: 'a' }).success).toBe(true);
    expect(PingMessageSchema.safeParse({ t: 'pong' }).success).toBe(false);
  });
});
