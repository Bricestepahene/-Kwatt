import { describe, expect, it } from 'vitest';
import {
  MACHINE_DIFFICULTIES,
  applyAutoDifficulty,
  betOdds,
  calibrationStatus,
  difficultyOffers,
  isDifficultyUnlocked,
  machinePreview,
  machineRating,
  nextWinStreak,
  oddsForRatings,
  oddsHundredths,
  settleMachineGame,
  streakBonusApplies,
  type MachineSettlementInput,
} from './machine.js';
import { winProbability } from './rating.js';

describe('difficultés de la machine (écran 15)', () => {
  it('5 difficultés : p cible et gain de base 25/25/40/60/100', () => {
    expect(MACHINE_DIFFICULTIES.map((d) => d.p)).toEqual([0.9, 0.75, 0.6, 0.5, 0.2]);
    expect(MACHINE_DIFFICULTIES.map((d) => d.baseReward)).toEqual([25, 25, 40, 60, 100]);
  });

  it('cote = 0,9 ÷ p : ×1 · ×1,2 · ×1,5 · ×1,8 · ×4,5 (écran 15)', () => {
    expect(MACHINE_DIFFICULTIES.map((d) => betOdds(d.p))).toEqual([1, 1.2, 1.5, 1.8, 4.5]);
    expect(oddsHundredths(0.5)).toBe(180);
    expect(() => oddsHundredths(0)).toThrow();
  });

  it('force de la machine = ta force − 400 × log10(p ÷ (1 − p)), et on retrouve p', () => {
    expect(machineRating(1482, 0.5)).toBe(1482);
    for (const d of MACHINE_DIFFICULTIES) {
      const m = machineRating(1482, d.p);
      expect(winProbability(1482, m)).toBeCloseTo(d.p, 2);
    }
    expect(machineRating(1500, 0.9)).toBe(1500 - Math.round(400 * Math.log10(9)));
    expect(machineRating(1500, 0.2)).toBeGreaterThan(1500);
  });

  it('cote réelle à partir des forces', () => {
    expect(oddsForRatings(1500, 1500)).toBe(1.8);
  });

  it('Fon débloqué à l’échelon Chef', () => {
    expect(isDifficultyUnlocked('fon', 'notable')).toBe(false);
    expect(isDifficultyUnlocked('fon', 'chef')).toBe(true);
    expect(isDifficultyUnlocked('coriace', 'apprenti')).toBe(true);
    const offers = difficultyOffers(1482, 'notable');
    expect(offers.map((o) => o.unlocked)).toEqual([true, true, true, true, false]);
    expect(offers[3]).toEqual({ id: 'ton_niveau', machineRating: 1482, oddsHundredths: 180, baseReward: 60, unlocked: true });
  });
});

describe('règlement d’une partie contre la machine', () => {
  const base: MachineSettlementInput = {
    difficulty: 'ton_niveau',
    outcome: 'win',
    bet: 200,
    oddsHundredths: 180,
    winStreakBefore: 0,
    rewardedToday: 0,
  };

  it('écran 15 : pari 200 à ×1,8 → +220 si tu gagnes, −190 si tu perds', () => {
    expect(machinePreview('ton_niveau', 200, 180)).toEqual({ ifWin: 220, ifLoss: -190 });
    const win = settleMachineGame(base);
    expect(win).toEqual({ net: 220, base: 60, participation: 0, betNet: 160, streakBonus: false, counted: true });
    const loss = settleMachineGame({ ...base, outcome: 'loss' });
    expect(loss).toEqual({ net: -190, base: 0, participation: 10, betNet: -200, streakBonus: false, counted: true });
  });

  it('sans pari : +25 la victoire, +10 la défaite (Facile)', () => {
    expect(settleMachineGame({ ...base, difficulty: 'facile', bet: 0, oddsHundredths: 100 }).net).toBe(25);
    expect(settleMachineGame({ ...base, difficulty: 'facile', bet: 0, oddsHundredths: 100, outcome: 'loss' }).net).toBe(10);
  });

  it('nulle : +10 de participation, la mise est rendue', () => {
    const draw = settleMachineGame({ ...base, outcome: 'draw' });
    expect(draw.net).toBe(10);
    expect(draw.betNet).toBe(0);
  });

  it('gain arrondi au cauris inférieur', () => {
    // 75 × (1,2 − 1) = 15 ; 55 × 0,2 = 11 ; 57 × 0,5 = 28,5 → 28.
    expect(settleMachineGame({ ...base, difficulty: 'coriace', bet: 57, oddsHundredths: 150 }).betNet).toBe(28);
  });

  it('série : après 3 victoires de suite, le gain suivant est ×1,5', () => {
    expect(streakBonusApplies(2)).toBe(false);
    expect(streakBonusApplies(3)).toBe(true);
    expect(streakBonusApplies(6)).toBe(true);
    expect(streakBonusApplies(0)).toBe(false);
    const s = settleMachineGame({ ...base, bet: 0, winStreakBefore: 3 });
    expect(s.base).toBe(90);
    expect(s.streakBonus).toBe(true);
    // Le ×1,5 porte sur le gain de base, pas sur le pari.
    expect(settleMachineGame({ ...base, winStreakBefore: 3 }).net).toBe(90 + 160);
    // Facile : 25 × 1,5 = 37,5 → 37.
    expect(settleMachineGame({ ...base, difficulty: 'facile', bet: 0, winStreakBefore: 3 }).base).toBe(37);
  });

  it('série : nulle et défaite la remettent à zéro', () => {
    expect(nextWinStreak(2, 'win')).toBe(3);
    expect(nextWinStreak(5, 'draw')).toBe(0);
    expect(nextWinStreak(5, 'loss')).toBe(0);
  });

  it('10 parties récompensées par jour : au-delà, ni gain de base ni participation', () => {
    const tenth = settleMachineGame({ ...base, bet: 0, rewardedToday: 9 });
    expect(tenth.counted).toBe(true);
    expect(tenth.net).toBe(60);
    const eleventh = settleMachineGame({ ...base, bet: 0, rewardedToday: 10 });
    expect(eleventh).toMatchObject({ counted: false, net: 0 });
    expect(settleMachineGame({ ...base, bet: 0, rewardedToday: 10, outcome: 'loss' }).net).toBe(0);
    // Un pari se règle quand même.
    expect(settleMachineGame({ ...base, rewardedToday: 10 }).net).toBe(160);
  });

  it('hors connexion : pas de pari (D-08)', () => {
    expect(() => settleMachineGame({ ...base, offline: true })).toThrow();
    expect(settleMachineGame({ ...base, bet: 0, offline: true }).net).toBe(60);
  });

  it('pari invalide', () => {
    expect(() => settleMachineGame({ ...base, bet: -5 })).toThrow();
    expect(() => settleMachineGame({ ...base, bet: 2.5 })).toThrow();
  });
});

describe('difficulté automatique (écran 14)', () => {
  it('monte d’un cran après 3 victoires de suite', () => {
    let s = { difficulty: 'moyen' as const, streak: 0 } as Parameters<typeof applyAutoDifficulty>[0];
    s = applyAutoDifficulty(s, 'win', 'notable');
    s = applyAutoDifficulty(s, 'win', 'notable');
    expect(s).toEqual({ difficulty: 'moyen', streak: 2 });
    s = applyAutoDifficulty(s, 'win', 'notable');
    expect(s).toEqual({ difficulty: 'coriace', streak: 0 });
  });

  it('baisse d’un cran après 3 défaites de suite', () => {
    let s = { difficulty: 'coriace', streak: 0 } as Parameters<typeof applyAutoDifficulty>[0];
    for (let i = 0; i < 3; i++) s = applyAutoDifficulty(s, 'loss', 'notable');
    expect(s).toEqual({ difficulty: 'moyen', streak: 0 });
  });

  it('une nulle ou un changement de sens remet le compteur à zéro', () => {
    let s = { difficulty: 'moyen', streak: 2 } as Parameters<typeof applyAutoDifficulty>[0];
    s = applyAutoDifficulty(s, 'draw', 'notable');
    expect(s.streak).toBe(0);
    s = applyAutoDifficulty({ difficulty: 'moyen', streak: 2 }, 'loss', 'notable');
    expect(s.streak).toBe(-1);
  });

  it('bornes : jamais sous Facile, jamais au-delà de ce qui est débloqué', () => {
    let s = { difficulty: 'facile', streak: -2 } as Parameters<typeof applyAutoDifficulty>[0];
    s = applyAutoDifficulty(s, 'loss', 'apprenti');
    expect(s.difficulty).toBe('facile');
    s = applyAutoDifficulty({ difficulty: 'ton_niveau', streak: 2 }, 'win', 'notable');
    expect(s.difficulty).toBe('ton_niveau');
    s = applyAutoDifficulty({ difficulty: 'ton_niveau', streak: 2 }, 'win', 'chef');
    expect(s.difficulty).toBe('fon');
  });
});

describe('mesure (45–55 % à ton niveau)', () => {
  it('statut de calibration', () => {
    expect(calibrationStatus(10, 20)).toBeNull();
    expect(calibrationStatus(50, 100)).toBe('ok');
    expect(calibrationStatus(60, 100)).toBe('too_easy');
    expect(calibrationStatus(40, 100)).toBe('too_hard');
  });
});
