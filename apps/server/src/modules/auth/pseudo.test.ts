import { describe, expect, it } from 'vitest';
import { checkPseudo, isBannedPseudo } from './pseudo.js';

describe('pseudo', () => {
  it('accepte les pseudos ordinaires', () => {
    for (const p of ['brice_237', 'Mireille', 'tchoumi.fon', 'computer', 'conrad', 'falcon', 'supporter_237', 'Nazir', 'dickens']) {
      expect({ p, problem: checkPseudo(p) }).toEqual({ p, problem: null });
    }
  });

  it('refuse le format invalide', () => {
    expect(checkPseudo('ab')).toBe('invalid');
    expect(checkPseudo('a'.repeat(21))).toBe('invalid');
    expect(checkPseudo('brice kamga')).toBe('invalid');
    expect(checkPseudo('brïce')).toBe('invalid');
  });

  it('refuse les mots réservés, même déguisés', () => {
    for (const p of ['admin', 'Admin_237', 'kwatt', 'KwattOfficiel', 'kw4tt', 'moderateur', 'support', 'staff_1']) {
      expect({ p, banned: isBannedPseudo(p) }).toEqual({ p, banned: true });
    }
  });

  it('refuse les insultes, y compris en l33t', () => {
    for (const p of ['connard', 'c0nnard', 'gros_con', 'con', 'pute', 'fuck_you', 'b1tch', 'salope99', 'merde.alors']) {
      expect({ p, banned: isBannedPseudo(p) }).toEqual({ p, banned: true });
    }
  });
});
