/**
 * Horloge du serveur. Les règles de temps (expiration des codes, 30 jours du pseudo, J+30 de
 * l'effacement) lisent cette horloge, pas `now()` de PostgreSQL : les tests peuvent l'avancer.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Horloge réglable pour les tests. */
export class ManualClock implements Clock {
  private t: number;
  constructor(start: Date | number = Date.now()) {
    this.t = typeof start === 'number' ? start : start.getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(date: Date): void {
    this.t = date.getTime();
  }
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}
