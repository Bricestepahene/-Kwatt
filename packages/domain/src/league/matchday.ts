/**
 * Journées de ligue (planche RegleLigues, écran 34 « Match du jour »).
 *
 * - Un match par jour ; chaque journée dure 24 h (heure du Cameroun).
 * - Les deux joueurs fixent un rendez-vous ; à défaut d'accord, le match est
 *   à 20:00. Créneaux proposés par l'écran 34 : 18:00, 19:30, 20:00, 21:30.
 * - Absent 10 minutes après l'heure fixée : défaite par forfait ; les deux
 *   absents : double forfait.
 * - Rappels 1 h et 10 min avant le match.
 * - Calendrier : journée 1 le jour du début, puis une journée par jour
 *   (14 joueurs, début le 10 nov. → 13 journées, fin le 22 nov.).
 */
import { KWATT_UTC_OFFSET_MINUTES, dayNumberOfKey } from '../time.js';
import type { MatchOutcome } from './standings.js';

/** Heure par défaut : 20:00, en minutes depuis minuit (heure du Cameroun). */
export const DEFAULT_MATCH_MINUTES = 20 * 60;
/** Créneaux proposés (écran 34). */
export const MATCH_TIME_SLOTS = ['18:00', '19:30', '20:00', '21:30'] as const;
/** Délai d'absence avant forfait. */
export const FORFEIT_GRACE_MS = 10 * 60_000;
/** Rappels avant le match. */
export const MATCH_REMINDERS_MS = [3_600_000, 600_000] as const;

const DAY_MS = 86_400_000;

/** « 20:00 » → 1 200 minutes. */
export function parseMatchTime(text: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  if (!m) throw new Error(`Heure invalide : ${text}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Heure invalide : ${text}`);
  return h * 60 + min;
}

export function formatMatchTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function keyOfDayNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Jour (« AAAA-MM-JJ ») de la journée `round` (1 = premier jour). */
export function roundDay(firstDay: string, round: number): string {
  if (!Number.isInteger(round) || round < 1) throw new Error('Journée invalide');
  return keyOfDayNumber(dayNumberOfKey(firstDay) + round - 1);
}

/** Dernier jour de la ligue (« fin prévue »). */
export function leagueEndDay(firstDay: string, rounds: number): string {
  return roundDay(firstDay, rounds);
}

/**
 * Heure retenue : celle sur laquelle les deux joueurs sont d'accord, sinon
 * 20:00 (« Sans accord, le match aura lieu à 20:00 »).
 */
export function agreedMatchMinutes(proposals: readonly [string | null, string | null]): number {
  const [a, b] = proposals;
  if (a !== null && b !== null && parseMatchTime(a) === parseMatchTime(b)) return parseMatchTime(a);
  return DEFAULT_MATCH_MINUTES;
}

/** Instant du match (ms UTC) pour un jour et une heure locale (heure du Cameroun). */
export function matchInstant(day: string, minutes: number, offsetMinutes = KWATT_UTC_OFFSET_MINUTES): number {
  return dayNumberOfKey(day) * DAY_MS + (minutes - offsetMinutes) * 60_000;
}

/** Instants des rappels (1 h et 10 min avant). */
export function reminderInstants(matchAt: number): number[] {
  return MATCH_REMINDERS_MS.map((d) => matchAt - d);
}

/**
 * Présence à l'heure du match : `null` tant que le délai de 10 minutes n'est
 * pas écoulé et que quelqu'un manque ; 'play' si les deux sont là ; sinon le
 * forfait (simple ou double).
 */
export function attendanceOutcome(input: {
  matchAt: number;
  now: number;
  /** Heure d'arrivée dans la salle, null si absent. */
  homeArrivedAt: number | null;
  awayArrivedAt: number | null;
}): 'play' | Extract<MatchOutcome, 'home_forfeit' | 'away_forfeit' | 'double_forfeit'> | null {
  const deadline = input.matchAt + FORFEIT_GRACE_MS;
  const here = (t: number | null): boolean => t !== null && t <= deadline;
  const home = here(input.homeArrivedAt);
  const away = here(input.awayArrivedAt);
  if (home && away) return 'play';
  if (input.now < deadline) return null;
  if (!home && !away) return 'double_forfeit';
  return home ? 'away_forfeit' : 'home_forfeit';
}
