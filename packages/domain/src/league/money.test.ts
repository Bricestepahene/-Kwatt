import { describe, expect, it } from 'vitest';
import {
  cancelAfterValidation,
  canAffordEntry,
  exclusionRefund,
  forfeitFine,
  fullLeaguePot,
  kwattBonus,
  leagueCaution,
  leagueJoinRefusal,
  leagueMinimumPlayers,
  leaguePot,
  potBalance,
  privateLeaguePot,
  publicLeagueCreationRefusal,
  splitPot,
  splitPrivatePot,
  validationOutcome,
} from './money.js';

const H = 3_600_000;

describe('Ligue Littoral — Dames (planche RegleLigues) : l’argent', () => {
  it('caution = 50 × places max = 50 × 16 = 800', () => {
    expect(leagueCaution(16)).toBe(800);
    expect(() => leagueCaution(1)).toThrow();
  });

  it('pot = 14 × 200 + bonus Kwatt 25 % (700) = 3 500', () => {
    expect(kwattBonus(14, 200)).toBe(700);
    expect(leaguePot(14, 200)).toBe(3500);
  });

  it('partage : 1er 1 225, 2e 700, 3e 350, participation 87 chacun (12), créateur 175 ; restes au 1er', () => {
    const ranking = Array.from({ length: 14 }, (_, i) => `j${i + 1}`);
    const finishers = ranking.slice(0, 12);
    const split = splitPot({ pot: 3500, ranking, finishers, creatorId: 'armand' });
    expect(split.first).toBe(1225);
    expect(split.second).toBe(700);
    expect(split.third).toBe(350);
    expect(split.participationEach).toBe(87);
    expect(split.creator).toBe(175);
    // 3 500 − (1 225 + 700 + 350 + 12 × 87 + 175) = 6, au 1er.
    expect(split.remainder).toBe(6);
    expect(split.payouts['j1']).toBe(1225 + 87 + 6);
    expect(split.payouts['j2']).toBe(700 + 87);
    expect(split.payouts['j13']).toBeUndefined();
    expect(split.payouts['armand']).toBe(175);
    expect(Object.values(split.payouts).reduce((a, b) => a + b, 0)).toBe(3500);
  });

  it('le créateur qui joue cumule sa part de créateur et ses gains', () => {
    const split = splitPot({ pot: 1000, ranking: ['a', 'b', 'c'], finishers: ['a', 'b', 'c'], creatorId: 'b' });
    expect(split.payouts['b']).toBe(200 + 100 + 50);
    expect(Object.values(split.payouts).reduce((x, y) => x + y, 0)).toBe(1000);
  });

  it('personne au bout : la participation revient au 1er', () => {
    const split = splitPot({ pot: 1000, ranking: ['a', 'b', 'c'], finishers: [], creatorId: 'z' });
    expect(split.participationEach).toBe(0);
    expect(split.payouts['a']).toBe(350 + 300);
  });

  it('amende de forfait : 10 % de l’entrée = 20 cauris', () => {
    expect(forfeitFine(200)).toBe(20);
    expect(forfeitFine(55)).toBe(5);
  });

  it('Fotso, exclu après J5 : ½ × 200 × 8 ÷ 13 = 61 rendus, 139 restent au pot avec ses 40 d’amendes', () => {
    expect(exclusionRefund(200, 8, 13)).toBe(61);
    expect(200 - exclusionRefund(200, 8, 13)).toBe(139);
    expect(() => exclusionRefund(200, 14, 13)).toThrow();
  });

  it('Tchoumi, exclu après J6 (écran 35) : 53 rendus, pot 3 500 → 3 487', () => {
    expect(exclusionRefund(200, 7, 13)).toBe(53);
    const pot = potBalance([
      { kind: 'entry', amount: 14 * 200 },
      { kind: 'kwatt_bonus', amount: 700 },
      { kind: 'fine', amount: 20 },
      { kind: 'fine', amount: 20 },
      { kind: 'exclusion_refund', amount: 53 },
    ]);
    expect(pot).toBe(3487);
  });

  it('annulation après validation : chacun récupère sa mise et la caution est partagée', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `j${i + 1}`);
    const out = cancelAfterValidation(800, 200, ids);
    // 800 ÷ 14 = 57, reste 2 → j1 et j2.
    expect(out['j1']).toBe(200 + 58);
    expect(out['j2']).toBe(200 + 58);
    expect(out['j3']).toBe(200 + 57);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(14 * 200 + 800);
    expect(cancelAfterValidation(800, 200, [])).toEqual({});
  });

  it('validation sous 48 h, minimum d’inscrits = max(4, ⌈places ÷ 2⌉)', () => {
    expect(leagueMinimumPlayers(16)).toBe(8);
    expect(leagueMinimumPlayers(4)).toBe(4);
    expect(leagueMinimumPlayers(6)).toBe(4);
    expect(leagueMinimumPlayers(15)).toBe(8);
    const closed = Date.UTC(2026, 10, 7, 23);
    const base = { entrants: 14, maxPlaces: 16, registrationClosedAt: closed };
    expect(validationOutcome({ ...base, validatedAt: closed + 2 * H })).toBe('validated');
    expect(validationOutcome({ ...base, validatedAt: closed + 48 * H })).toBe('validated');
    expect(validationOutcome({ ...base, validatedAt: closed + 48 * H + 1 })).toBe('cancelled_not_validated');
    expect(validationOutcome({ ...base, validatedAt: null })).toBe('cancelled_not_validated');
    expect(validationOutcome({ ...base, entrants: 7, validatedAt: closed })).toBe('cancelled_not_enough_players');
  });

  it('« Il te manque 80 cauris »', () => {
    expect(canAffordEntry(120, 200)).toEqual({ ok: false, missing: 80 });
    expect(canAffordEntry(2450, 200)).toEqual({ ok: true, missing: 0 });
  });
});

describe('créer une ligue publique (écran 31)', () => {
  const ok = { kind: 'member' as const, age: 30, rank: 'chef' as const, balance: 2450, maxPlaces: 16, entry: 200 };

  it('16 places à 200 : caution 800, pot complet 4 000, champion 1 400, créateur 200', () => {
    expect(publicLeagueCreationRefusal(ok)).toBeNull();
    const pot = fullLeaguePot(16, 200);
    expect(pot).toBe(4000);
    expect(Math.floor(pot * 0.35)).toBe(1400);
    expect(Math.floor(pot * 0.05)).toBe(200);
  });

  it('refus : invité, mineur, échelon trop bas, réglages hors bornes, caution supérieure au solde', () => {
    expect(publicLeagueCreationRefusal({ ...ok, kind: 'guest', age: null })).toBe('league.guest');
    expect(publicLeagueCreationRefusal({ ...ok, age: 16 })).toBe('league.underage');
    expect(publicLeagueCreationRefusal({ ...ok, rank: 'debrouillard' })).toBe('league.rank_too_low');
    expect(publicLeagueCreationRefusal({ ...ok, rank: 'ancien' })).toBeNull();
    expect(publicLeagueCreationRefusal({ ...ok, maxPlaces: 15 })).toBe('league.places_invalid');
    expect(publicLeagueCreationRefusal({ ...ok, maxPlaces: 66 })).toBe('league.places_invalid');
    expect(publicLeagueCreationRefusal({ ...ok, entry: 75 })).toBe('league.entry_invalid');
    expect(publicLeagueCreationRefusal({ ...ok, entry: 1050 })).toBe('league.entry_invalid');
    // 50 places × 50 = 2 500 > 2 450.
    expect(publicLeagueCreationRefusal({ ...ok, maxPlaces: 50 })).toBe('league.caution_above_balance');
  });
});

describe('s’inscrire à une ligue', () => {
  const pub = {
    access: 'public' as const,
    entry: 200,
    entrants: 14,
    maxPlaces: 16,
    kind: 'member' as const,
    age: 30,
    rank: 'notable' as const,
    minRank: 'debrouillard' as const,
    balance: 2450,
  };

  it('ligue publique : échelon minimum, solde suffisant, places libres', () => {
    expect(leagueJoinRefusal(pub)).toBeNull();
    expect(leagueJoinRefusal({ ...pub, rank: 'apprenti' })).toBe('league.rank_too_low');
    expect(leagueJoinRefusal({ ...pub, balance: 120 })).toBe('league.insufficient_balance');
    expect(leagueJoinRefusal({ ...pub, entrants: 16 })).toBe('league.full');
  });

  it('invité : seulement une ligue privée gratuite ; compte jeune : pas de ligue payante', () => {
    const guest = { ...pub, kind: 'guest' as const, age: null, balance: 0, minRank: null };
    expect(leagueJoinRefusal(guest)).toBe('league.guest_public');
    expect(leagueJoinRefusal({ ...guest, access: 'private' })).toBe('league.guest_paid');
    expect(leagueJoinRefusal({ ...guest, access: 'private', entry: 0 })).toBeNull();
    expect(leagueJoinRefusal({ ...pub, age: 15 })).toBe('league.underage_paid');
    expect(leagueJoinRefusal({ ...pub, access: 'private', age: 15, entry: 0 })).toBeNull();
  });
});

describe('ligue privée : cagnotte', () => {
  it('Championnat du Kwatt : 10 × 50 = 500, le champion rafle tout', () => {
    expect(privateLeaguePot(10, 50)).toBe(500);
    expect(splitPrivatePot(500, 'armand')).toEqual({ armand: 500 });
    expect(splitPrivatePot(0, 'armand')).toEqual({});
  });
});
