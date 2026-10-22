/**
 * Découpage du temps : jour, semaine, mois (saison). Fonctions pures : l'heure
 * courante est toujours passée en paramètre (ms depuis l'époque Unix, UTC).
 *
 * Fuseau de référence de Kwatt : heure du Cameroun (UTC+1, sans heure d'été).
 * Le plafond de 10 parties par jour, le problème du jour, les séries de jours,
 * les quêtes de la semaine et les saisons (mois civil) basculent à minuit,
 * heure de Douala, pour tout le monde. Le décalage reste paramétrable.
 */

export const KWATT_UTC_OFFSET_MINUTES = 60;
const DAY_MS = 86_400_000;

function shifted(at: number, offsetMinutes: number): Date {
  return new Date(at + offsetMinutes * 60_000);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Jour civil « AAAA-MM-JJ ». */
export function dayKey(at: number, offsetMinutes = KWATT_UTC_OFFSET_MINUTES): string {
  const d = shifted(at, offsetMinutes);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Numéro de jour (jours écoulés depuis le 1970-01-01 dans le fuseau). */
export function dayNumber(at: number, offsetMinutes = KWATT_UTC_OFFSET_MINUTES): number {
  return Math.floor((at + offsetMinutes * 60_000) / DAY_MS);
}

/** Numéro de jour d'une clé « AAAA-MM-JJ ». */
export function dayNumberOfKey(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Jour invalide : ${key}`);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** Mois civil « AAAA-MM » (une saison de la Guerre des quartiers). */
export function monthKey(at: number, offsetMinutes = KWATT_UTC_OFFSET_MINUTES): string {
  const d = shifted(at, offsetMinutes);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Semaine ISO « AAAA-Www » (lundi au dimanche) : quêtes de la semaine. */
export function isoWeekKey(at: number, offsetMinutes = KWATT_UTC_OFFSET_MINUTES): string {
  const d = shifted(at, offsetMinutes);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

/** Début (inclus) et fin (exclue) d'un mois « AAAA-MM », en ms UTC. */
export function monthBounds(key: string, offsetMinutes = KWATT_UTC_OFFSET_MINUTES): { start: number; end: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Mois invalide : ${key}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const off = offsetMinutes * 60_000;
  return { start: Date.UTC(y, mo, 1) - off, end: Date.UTC(y, mo + 1, 1) - off };
}
