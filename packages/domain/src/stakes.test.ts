import { describe, expect, it } from 'vitest';
import { canStakeTogether, sameDeviceConflicts, settleStakes, stakeCap, stakeRefusal, validateStake } from './stakes.js';

describe('plafond de mise', () => {
  it('écran 26 : soldes 2 450 et 1 800, deux Notables → plafond 450 (25 % du plus petit solde)', () => {
    const cap = stakeCap([
      { userId: 'brice', balance: 2450, rank: 'notable' },
      { userId: 'mireille', balance: 1800, rank: 'notable' },
    ]);
    expect(cap).toEqual({ max: 450, balanceCap: 450, tableLimit: 500, limitedBy: 'balance' });
  });

  it('limite de la table selon l’échelon le plus bas : Débrouillard → 100', () => {
    const cap = stakeCap([
      { userId: 'a', balance: 10_000, rank: 'fon' },
      { userId: 'b', balance: 8_000, rank: 'debrouillard' },
    ]);
    expect(cap).toEqual({ max: 100, balanceCap: 2000, tableLimit: 100, limitedBy: 'table' });
  });

  it('chaque échelon a sa limite : 50 / 100 / 200 / 500 / 2 000 / 5 000', () => {
    const rich = 1_000_000;
    const limits = (['apprenti', 'debrouillard', 'ancien', 'notable', 'chef', 'fon'] as const).map(
      (rank) => stakeCap([{ userId: 'x', balance: rich, rank }, { userId: 'y', balance: rich, rank: 'fon' }]).max,
    );
    expect(limits).toEqual([50, 100, 200, 500, 2000, 5000]);
  });

  it('arrondi au cauris inférieur, jamais négatif', () => {
    expect(stakeCap([{ userId: 'a', balance: 203, rank: 'fon' }, { userId: 'b', balance: 999, rank: 'fon' }]).max).toBe(50);
    expect(stakeCap([{ userId: 'a', balance: -10, rank: 'fon' }, { userId: 'b', balance: 999, rank: 'fon' }]).max).toBe(0);
  });

  it('une mise se joue à deux au moins (Ludo : jusqu’à 6)', () => {
    expect(() => stakeCap([{ userId: 'a', balance: 100, rank: 'fon' }])).toThrow();
    const cap = stakeCap([
      { userId: 'a', balance: 4000, rank: 'chef' },
      { userId: 'b', balance: 4000, rank: 'chef' },
      { userId: 'c', balance: 1000, rank: 'chef' },
    ]);
    expect(cap.max).toBe(250);
  });

  it('validation d’une mise proposée', () => {
    const players = [
      { userId: 'a', balance: 2450, rank: 'notable' as const },
      { userId: 'b', balance: 1800, rank: 'notable' as const },
    ];
    expect(validateStake(450, players)).toBeNull();
    expect(validateStake(500, players)).toBe('stake.above_cap');
    expect(validateStake(0, players)).toBe('stake.invalid');
    expect(validateStake(12.5, players)).toBe('stake.invalid');
  });
});

describe('qui peut miser', () => {
  it('18 ans et plus, profils seulement, e-mail vérifié', () => {
    expect(stakeRefusal({ kind: 'guest', age: null, emailVerified: false })).toBe('stake.guest');
    expect(stakeRefusal({ kind: 'member', age: 17, emailVerified: true })).toBe('stake.underage');
    expect(stakeRefusal({ kind: 'member', age: 18, emailVerified: false })).toBe('stake.email_unverified');
    expect(stakeRefusal({ kind: 'member', age: 30, emailVerified: true })).toBeNull();
  });

  it('jamais deux comptes du même appareil l’un contre l’autre', () => {
    const players = [
      { userId: 'a', deviceIds: ['d1', 'd2'] },
      { userId: 'b', deviceIds: ['d3'] },
      { userId: 'c', deviceIds: ['d2'] },
    ];
    expect(sameDeviceConflicts(players)).toEqual([['a', 'c']]);
    expect(canStakeTogether(players)).toBe(false);
    expect(canStakeTogether(players.slice(0, 2))).toBe(true);
  });
});

describe('règlement d’une mise entre joueurs', () => {
  it('le gagnant prend le pot ; nulle : chacun récupère sa mise', () => {
    expect(settleStakes(300, ['a', 'b'], 'a')).toEqual({ a: 600, b: 0 });
    expect(settleStakes(300, ['a', 'b'], null)).toEqual({ a: 300, b: 300 });
    expect(settleStakes(100, ['a', 'b', 'c', 'd'], 'c')).toEqual({ a: 0, b: 0, c: 400, d: 0 });
  });
});
