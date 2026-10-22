import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_MINUTES,
  agreedMatchMinutes,
  attendanceOutcome,
  formatMatchTime,
  leagueEndDay,
  matchInstant,
  parseMatchTime,
  reminderInstants,
  roundDay,
} from './matchday.js';

const MIN = 60_000;

describe('journées de ligue (écran 34)', () => {
  it('14 joueurs, début le 10 nov. : 13 journées, fin le 22 nov.', () => {
    expect(roundDay('2026-11-10', 1)).toBe('2026-11-10');
    expect(roundDay('2026-11-10', 8)).toBe('2026-11-17');
    expect(leagueEndDay('2026-11-10', 13)).toBe('2026-11-22');
    expect(leagueEndDay('2026-12-25', 13)).toBe('2027-01-06');
    expect(() => roundDay('2026-11-10', 0)).toThrow();
  });

  it('sans accord, le match est à 20:00 ; heure locale du Cameroun', () => {
    expect(DEFAULT_MATCH_MINUTES).toBe(1200);
    expect(agreedMatchMinutes(['20:00', '20:00'])).toBe(1200);
    expect(agreedMatchMinutes(['19:30', '19:30'])).toBe(1170);
    expect(agreedMatchMinutes(['18:00', null])).toBe(1200);
    expect(agreedMatchMinutes(['18:00', '21:30'])).toBe(1200);
    expect(formatMatchTime(1170)).toBe('19:30');
    expect(() => parseMatchTime('25:00')).toThrow();
    // 20:00 à Douala = 19:00 UTC.
    expect(matchInstant('2026-11-10', 1200)).toBe(Date.UTC(2026, 10, 10, 19, 0));
  });

  it('rappels 1 h et 10 min avant', () => {
    const at = matchInstant('2026-11-10', 1200);
    expect(reminderInstants(at)).toEqual([at - 60 * MIN, at - 10 * MIN]);
  });

  it('absent après 10 min : forfait ; les deux absents : double forfait', () => {
    const matchAt = matchInstant('2026-11-15', 1200);
    expect(attendanceOutcome({ matchAt, now: matchAt + 5 * MIN, homeArrivedAt: matchAt - MIN, awayArrivedAt: null })).toBeNull();
    expect(attendanceOutcome({ matchAt, now: matchAt + 5 * MIN, homeArrivedAt: matchAt - MIN, awayArrivedAt: matchAt + 4 * MIN })).toBe('play');
    expect(attendanceOutcome({ matchAt, now: matchAt + 10 * MIN, homeArrivedAt: matchAt, awayArrivedAt: null })).toBe('away_forfeit');
    expect(attendanceOutcome({ matchAt, now: matchAt + 11 * MIN, homeArrivedAt: null, awayArrivedAt: matchAt + 2 * MIN })).toBe('home_forfeit');
    expect(attendanceOutcome({ matchAt, now: matchAt + 10 * MIN, homeArrivedAt: null, awayArrivedAt: null })).toBe('double_forfeit');
    // Arrivé après les 10 minutes : trop tard.
    expect(attendanceOutcome({ matchAt, now: matchAt + 12 * MIN, homeArrivedAt: matchAt, awayArrivedAt: matchAt + 11 * MIN })).toBe('away_forfeit');
  });
});
