import { describe, expect, it } from 'vitest';
import { dayKey, dayNumber, dayNumberOfKey, isoWeekKey, monthBounds, monthKey } from './time.js';
import {
  canChangeQuarter,
  quarterPoints,
  quarterPointsMulti,
  rankQuarters,
  seasonChampion,
  seasonDaysLeft,
  seasonKey,
  seasonNumber,
} from './quarters.js';
import { PREDICTION_STAKE, predictionShares, predictionsOpen, settlePredictions } from './predictions.js';
import {
  DAILY_PUZZLE_REWARD,
  WEEKLY_QUESTS,
  currentStreak,
  daysToNextStreakReward,
  questProgress,
  recordActiveDay,
  type QuestEvent,
} from './quests.js';

const H = 3_600_000;

describe('temps (heure du Cameroun, UTC+1)', () => {
  it('le jour bascule à minuit à Douala', () => {
    expect(dayKey(Date.UTC(2026, 9, 31, 22, 59))).toBe('2026-10-31');
    expect(dayKey(Date.UTC(2026, 9, 31, 23, 0))).toBe('2026-11-01');
    expect(dayNumber(Date.UTC(2026, 9, 31, 23, 0))).toBe(dayNumberOfKey('2026-11-01'));
    expect(() => dayNumberOfKey('2026-1-1')).toThrow();
  });

  it('mois civil et bornes', () => {
    expect(monthKey(Date.UTC(2026, 9, 31, 23, 30))).toBe('2026-11');
    const b = monthBounds('2026-11');
    expect(b.start).toBe(Date.UTC(2026, 10, 1) - H);
    expect(b.end).toBe(Date.UTC(2026, 11, 1) - H);
    expect(monthBounds('2026-12').end).toBe(Date.UTC(2027, 0, 1) - H);
  });

  it('semaine ISO, du lundi au dimanche', () => {
    expect(isoWeekKey(Date.UTC(2026, 9, 22, 12))).toBe('2026-W43');
    expect(isoWeekKey(Date.UTC(2027, 0, 1, 12))).toBe('2026-W53');
    // Dimanche 25 octobre 23:30 à Douala : encore la semaine 43 ; lundi 0:00 : semaine 44.
    expect(isoWeekKey(Date.UTC(2026, 9, 25, 22, 30))).toBe('2026-W43');
    expect(isoWeekKey(Date.UTC(2026, 9, 25, 23, 0))).toBe('2026-W44');
  });
});

describe('guerre des quartiers (écran 36)', () => {
  const win = { ranked: true, winnerRating: 1400, loserRating: 1300, winnerQuarter: 'bonamoussadi', loserQuarter: 'bonamoussadi' };

  it('victoire classée +3, contre plus fort +5, quartier rival +2', () => {
    expect(quarterPoints(win)).toBe(3);
    expect(quarterPoints({ ...win, loserRating: 1500 })).toBe(5);
    expect(quarterPoints({ ...win, loserQuarter: 'akwa' })).toBe(5);
    expect(quarterPoints({ ...win, loserRating: 1500, loserQuarter: 'akwa' })).toBe(7);
    // À force égale, ce n'est pas « plus fort ».
    expect(quarterPoints({ ...win, loserRating: 1400 })).toBe(3);
  });

  it('rien pour une partie amicale, contre la machine ou sans quartier', () => {
    expect(quarterPoints({ ...win, ranked: false })).toBe(0);
    expect(quarterPoints({ ...win, vsMachine: true })).toBe(0);
    expect(quarterPoints({ ...win, winnerQuarter: null })).toBe(0);
    expect(quarterPoints({ ...win, loserQuarter: null })).toBe(3);
  });

  it('Ludo : seul le 1er marque, bonus une seule fois', () => {
    const beaten = [
      { rating: 1200, quarter: 'akwa' },
      { rating: 1500, quarter: 'deido' },
      { rating: 1100, quarter: 'bonamoussadi' },
    ];
    expect(quarterPointsMulti({ ranked: true, winnerRating: 1400, winnerQuarter: 'bonamoussadi', beaten })).toBe(7);
    expect(quarterPointsMulti({ ranked: true, winnerRating: 1600, winnerQuarter: 'bonamoussadi', beaten: [beaten[2]!] })).toBe(3);
    expect(quarterPointsMulti({ ranked: false, winnerRating: 1600, winnerQuarter: 'x', beaten })).toBe(0);
  });

  it('saison = mois civil, changement de quartier une fois par saison', () => {
    const oct = Date.UTC(2026, 9, 10);
    expect(seasonKey(oct)).toBe('2026-10');
    expect(seasonNumber('2026-10', '2026-08')).toBe(3);
    expect(seasonNumber('2027-01', '2026-11')).toBe(3);
    expect(canChangeQuarter(null, oct)).toBe(true);
    expect(canChangeQuarter(Date.UTC(2026, 9, 2), oct)).toBe(false);
    expect(canChangeQuarter(Date.UTC(2026, 8, 30), oct)).toBe(true);
  });

  it('« encore 9 jours » : jours restants, jour courant compris', () => {
    // 23 octobre à midi (Douala) : du 23 au 31, 9 jours.
    expect(seasonDaysLeft(Date.UTC(2026, 9, 23, 11))).toBe(9);
    expect(seasonDaysLeft(Date.UTC(2026, 9, 31, 22))).toBe(1);
  });

  it('classement des quartiers de Douala et champion de saison', () => {
    const rows = rankQuarters([
      { id: 'Bonamoussadi', points: 8590, players: 212 },
      { id: 'Akwa', points: 9840, players: 304 },
      { id: 'Makepe', points: 8760, players: 260 },
      { id: 'Bonapriso', points: 9120, players: 188 },
    ]);
    expect(rows.map((r) => [r.id, r.position])).toEqual([
      ['Akwa', 1],
      ['Bonapriso', 2],
      ['Makepe', 3],
      ['Bonamoussadi', 4],
    ]);
    expect(seasonChampion(rows)).toBe('Akwa');
    expect(seasonChampion([{ id: 'x', points: 0, players: 3 }])).toBeNull();
  });
});

describe('pronostics (écran 37)', () => {
  it('fermés au coup 10 (Dames) ou au tour 10 (Ludo)', () => {
    expect(predictionsOpen({ kind: 'dames', ply: 17 })).toBe(true);
    expect(predictionsOpen({ kind: 'dames', ply: 18 })).toBe(false);
    expect(predictionsOpen({ kind: 'ludo', round: 9 })).toBe(true);
    expect(predictionsOpen({ kind: 'ludo', round: 10 })).toBe(false);
  });

  it('pari mutuel à 50 cauris : les gagnants se partagent tout', () => {
    expect(PREDICTION_STAKE).toBe(50);
    const preds = [
      { userId: 'u1', pick: 'armand', order: 1 },
      { userId: 'u2', pick: 'christelle', order: 2 },
      { userId: 'u3', pick: 'armand', order: 3 },
    ];
    const s = settlePredictions(preds, 'christelle');
    expect(s).toEqual({ outcome: 'paid', reason: null, payouts: { u1: 0, u2: 150, u3: 0 } });
    // 150 ÷ 2 = 75 chacun.
    expect(settlePredictions(preds, 'armand').payouts).toEqual({ u1: 75, u2: 0, u3: 75 });
  });

  it('restes : un cauris aux premiers à avoir parié', () => {
    const preds = [
      { userId: 'a', pick: 'x', order: 3 },
      { userId: 'b', pick: 'x', order: 1 },
      { userId: 'c', pick: 'x', order: 2 },
      { userId: 'd', pick: 'y', order: 4 },
    ];
    // 200 ÷ 3 = 66, reste 2 → b et c.
    const s = settlePredictions(preds, 'x');
    expect(s.payouts).toEqual({ a: 66, b: 67, c: 67, d: 0 });
    expect(Object.values(s.payouts).reduce((x, y) => x + y, 0)).toBe(200);
  });

  it('remboursement si tout le monde a parié du même côté, si nulle, ou si personne n’a vu juste', () => {
    const same = [
      { userId: 'a', pick: 'x', order: 1 },
      { userId: 'b', pick: 'x', order: 2 },
    ];
    expect(settlePredictions(same, 'y')).toEqual({ outcome: 'refunded', reason: 'one_side', payouts: { a: 50, b: 50 } });
    const two = [...same, { userId: 'c', pick: 'z', order: 3 }];
    expect(settlePredictions(two, null).reason).toBe('draw');
    // Ludo à 4 : personne n'a misé sur le vainqueur.
    expect(settlePredictions(two, 'w')).toMatchObject({ outcome: 'refunded', reason: 'no_winner_pick' });
    expect(settlePredictions([], 'x').payouts).toEqual({});
  });

  it('répartition affichée : total 100 %', () => {
    const preds = Array.from({ length: 13 }, (_, i) => ({ userId: `u${i}`, pick: i < 8 ? 'armand' : 'christelle', order: i }));
    const shares = predictionShares(preds);
    expect(shares).toEqual({ armand: 62, christelle: 38 });
    const three = predictionShares([
      { userId: 'a', pick: 'p', order: 1 },
      { userId: 'b', pick: 'q', order: 2 },
      { userId: 'c', pick: 'r', order: 3 },
    ]);
    expect(Object.values(three).reduce((x, y) => x + y, 0)).toBe(100);
    expect(predictionShares([])).toEqual({});
  });
});

describe('séries de jours et quêtes (écrans 19b et 40)', () => {
  it('série : 7 jours de suite → carte rare au choix, puis à 14…', () => {
    let s = { lastDay: null as number | null, length: 0 };
    const earned: number[] = [];
    for (let d = 100; d < 115; d++) {
      const u = recordActiveDay(s, d);
      if (u.rareCardEarned) earned.push(u.streak.length);
      s = u.streak;
    }
    expect(earned).toEqual([7, 14]);
    expect(recordActiveDay(s, 114).alreadyCounted).toBe(true);
  });

  it('un jour manqué remet la série à 1 ; affichage à 0 si hier n’a pas été joué', () => {
    const s = { lastDay: 100, length: 6 };
    expect(recordActiveDay(s, 102).streak).toEqual({ lastDay: 102, length: 1 });
    expect(currentStreak(s, 101)).toBe(6);
    expect(currentStreak(s, 102)).toBe(0);
    expect(currentStreak({ lastDay: null, length: 0 }, 5)).toBe(0);
    expect(() => recordActiveDay(s, 99)).toThrow();
  });

  it('« Au 7e jour » : jours avant la prochaine carte', () => {
    expect(daysToNextStreakReward(5)).toBe(2);
    expect(daysToNextStreakReward(6)).toBe(1);
    expect(daysToNextStreakReward(7)).toBe(7);
  });

  it('problème du jour : +10', () => {
    expect(DAILY_PUZZLE_REWARD).toBe(10);
  });

  it('quêtes de l’écran 40 : +50, carte rare, +80', () => {
    expect(WEEKLY_QUESTS.map((q) => q.reward)).toEqual([
      { kind: 'cauris', amount: 50 },
      { kind: 'card', rarity: 'rare' },
      { kind: 'cauris', amount: 80 },
    ]);
    const events: QuestEvent[] = [
      { kind: 'game_won', game: 'ludo' },
      { kind: 'game_won', game: 'dames' },
      { kind: 'game_won', game: 'ludo' },
      { kind: 'capture', game: 'dames', count: 2 },
    ];
    const [ludo, twoLeg, rafle] = WEEKLY_QUESTS;
    expect(questProgress(ludo!, events)).toEqual({ progress: 2, target: 3, done: false });
    expect(questProgress(twoLeg!, events).done).toBe(false);
    expect(questProgress(rafle!, events).done).toBe(false);
    const more: QuestEvent[] = [...events, { kind: 'capture', game: 'dames', count: 3 }, { kind: 'game_won', game: 'ludo' }, { kind: 'game_won', game: 'ludo' }];
    expect(questProgress(rafle!, more)).toEqual({ progress: 1, target: 1, done: true });
    expect(questProgress(ludo!, more)).toEqual({ progress: 3, target: 3, done: true });
    expect(questProgress(twoLeg!, [{ kind: 'two_leg_won', game: 'dames' }]).done).toBe(true);
  });
});
