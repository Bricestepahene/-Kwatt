/**
 * Règles d'âge (écran 04, SPEC §6). L'année de naissance n'est jamais renvoyée ni affichée.
 * L'âge se calcule comme sur l'écran 04 : année en cours − année de naissance.
 *   < 13 ans  → pas de profil (invité seulement)
 *   13–17 ans → compte jeune : pas de mise, pas de pronostic, pas de ligue payante, invisible des inconnus
 *   ≥ 18 ans  → compte complet
 */
import { ADULT_AGE, MIN_PROFILE_AGE, type AgeGroup, type Permissions, type UserKind } from '@kwatt/protocol';

export const OLDEST_BIRTH_YEAR = 1900;

export function ageInYear(birthYear: number, now: Date): number {
  return now.getUTCFullYear() - birthYear;
}

/** Tranche d'âge d'une année de naissance : 'child' (< 13), 'teen', 'adult'. */
export function ageBand(birthYear: number, now: Date): 'child' | AgeGroup {
  const age = ageInYear(birthYear, now);
  if (age < MIN_PROFILE_AGE) return 'child';
  return age < ADULT_AGE ? 'teen' : 'adult';
}

export function isPlausibleBirthYear(birthYear: number, now: Date): boolean {
  return Number.isInteger(birthYear) && birthYear >= OLDEST_BIRTH_YEAR && birthYear <= now.getUTCFullYear();
}

/** Droits d'un compte, calculés à chaque lecture (l'âge avance avec l'année). */
export function permissionsFor(kind: UserKind, ageGroup: AgeGroup | null, verified: boolean): Permissions {
  const member = kind === 'member';
  const adult = member && ageGroup === 'adult';
  const stakes = adult && verified;
  return {
    canStake: stakes,
    canPredict: stakes,
    canJoinPaidLeagues: stakes,
    canCreate: member,
    visibleToStrangers: adult,
  };
}
