/**
 * Logique pure des écrans d'entrée et des Paramètres (équipe Comptes), testée par vitest :
 * solidité du mot de passe, âge (écran 04), pseudo, masque de l'adresse, compte à rebours,
 * libellés des quartiers, état d'un salon trouvé par son code.
 */
import {
  ADULT_AGE,
  MIN_PROFILE_AGE,
  PASSWORD_MIN_LENGTH,
  PSEUDO_MAX_LENGTH,
  PSEUDO_MIN_LENGTH,
  type Quarter,
  type RoomPreview,
} from '@kwatt/protocol';

// --- Mot de passe ------------------------------------------------------------------------

export type PasswordLevel = 'empty' | 'tooShort' | 'weak' | 'medium' | 'strong';
/** Conseil affiché sous la jauge (clé de traduction `accounts:password.hint.<…>`). */
export type PasswordHint = 'empty' | 'tooShort' | 'common' | 'mix' | 'symbol' | 'digit' | 'upper' | 'longer' | 'strong';

export interface PasswordStrength {
  level: PasswordLevel;
  /** Segments allumés sur 3 (jauge de la planche Inscription). */
  segments: 0 | 1 | 2 | 3;
  hint: PasswordHint;
}

/** Mots de passe trop connus (comparés sans les chiffres de la fin). */
const COMMON_PASSWORDS = new Set([
  'motdepasse', 'password', 'passw0rd', 'azerty', 'azertyuiop', 'qwerty', 'qwertyuiop', 'iloveyou', 'jetaime',
  'football', 'cameroun', 'cameroon', 'douala', 'yaounde', 'kwatt', 'soleil', 'bonjour', 'welcome', 'admin',
  'abcdef', 'abcdefgh', 'letmein', 'monkey', 'dragon', 'secret', 'princesse', 'loulou', 'doudou', 'chouchou',
]);

function isTrivial(password: string): boolean {
  const lower = password.toLowerCase();
  const stem = lower.replace(/[0-9!.?*_-]+$/, '');
  if (COMMON_PASSWORDS.has(stem) || COMMON_PASSWORDS.has(lower)) return true;
  if (/^(.)\1+$/.test(password)) return true;
  // Suite de chiffres ou de lettres (« 12345678 », « abcdefgh »).
  const codes = [...lower].map((c) => c.charCodeAt(0));
  const ascending = codes.every((c, i) => i === 0 || c === (codes[i - 1] ?? 0) + 1);
  const descending = codes.every((c, i) => i === 0 || c === (codes[i - 1] ?? 0) - 1);
  return ascending || descending;
}

/**
 * Solidité (indicatrice : le serveur n'exige que 8 caractères, SPEC §6).
 * Faible : trop connu, ou une seule sorte de caractères. Moyen : deux sortes, ou 12 caractères.
 * Solide : 12 caractères et trois sortes, ou 10 et quatre, ou 16 et deux.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length === 0) return { level: 'empty', segments: 0, hint: 'empty' };
  if (password.length < PASSWORD_MIN_LENGTH) return { level: 'tooShort', segments: 1, hint: 'tooShort' };
  if (isTrivial(password)) return { level: 'weak', segments: 1, hint: 'common' };
  const lower = /[a-z]/.test(password);
  const upper = /[A-Z]/.test(password);
  const digit = /[0-9]/.test(password);
  const symbol = /[^A-Za-z0-9]/.test(password);
  const kinds = [lower || upper, digit, symbol, lower && upper].filter(Boolean).length;
  const n = password.length;
  if ((n >= 12 && kinds >= 3) || (n >= 10 && kinds >= 4) || (n >= 16 && kinds >= 2)) {
    return { level: 'strong', segments: 3, hint: 'strong' };
  }
  if (kinds >= 2 || n >= 12) {
    const hint: PasswordHint = !symbol ? 'symbol' : !digit ? 'digit' : !(lower && upper) ? 'upper' : 'longer';
    return { level: 'medium', segments: 2, hint };
  }
  return { level: 'weak', segments: 1, hint: 'mix' };
}

// --- Âge (écran 04) ------------------------------------------------------------------------

/** Bornes du sélecteur d'année (planche Âge : de 1930 à l'année en cours). */
export const OLDEST_PICKABLE_YEAR = 1930;
/** Âge proposé au départ (planche : 2010 en 2026, soit 16 ans). */
export const DEFAULT_PICKED_AGE = 16;

export type AgeBand = 'child' | 'teen' | 'adult';

/** Âge comme le serveur le calcule : année en cours − année de naissance. */
export function ageFor(birthYear: number, currentYear: number): number {
  return currentYear - birthYear;
}

export function ageBandFor(age: number): AgeBand {
  if (age < MIN_PROFILE_AGE) return 'child';
  return age < ADULT_AGE ? 'teen' : 'adult';
}

export function clampBirthYear(year: number, currentYear: number): number {
  return Math.min(currentYear, Math.max(OLDEST_PICKABLE_YEAR, Math.round(year)));
}

/** Ce que chaque compte permet (lignes de la planche Âge). `ancien` : « dès Ancien du kwatt ». */
export type AgeRuleValue = 'yes' | 'no' | 'ancien';
export interface AgeRule {
  key: string;
  value: AgeRuleValue;
}

export function ageRules(band: AgeBand): AgeRule[] {
  switch (band) {
    case 'child':
      return [
        { key: 'joinAsGuest', value: 'yes' },
        { key: 'createProfile', value: 'no' },
        { key: 'stakeCauris', value: 'no' },
      ];
    case 'teen':
      return [
        { key: 'play', value: 'yes' },
        { key: 'freeLeagues', value: 'yes' },
        { key: 'stakeVsPlayer', value: 'no' },
        { key: 'paidLeaguesPredictions', value: 'no' },
        { key: 'visibleToStrangers', value: 'no' },
      ];
    case 'adult':
      return [
        { key: 'play', value: 'yes' },
        { key: 'freeAndPaidLeagues', value: 'yes' },
        { key: 'stakeVsPlayer', value: 'yes' },
        { key: 'predictions', value: 'yes' },
        { key: 'createPublicLeague', value: 'ancien' },
      ];
  }
}

// --- Pseudo ----------------------------------------------------------------------------------

export type LocalPseudoProblem = 'empty' | 'tooShort' | 'tooLong' | 'chars' | null;

/** Contrôle de forme avant d'interroger le serveur (3 à 20 caractères [a-zA-Z0-9_.]). */
export function localPseudoProblem(pseudo: string): LocalPseudoProblem {
  if (pseudo.length === 0) return 'empty';
  if (!/^[a-zA-Z0-9_.]*$/.test(pseudo)) return 'chars';
  if (pseudo.length < PSEUDO_MIN_LENGTH) return 'tooShort';
  if (pseudo.length > PSEUDO_MAX_LENGTH) return 'tooLong';
  return null;
}

/** Adresse e-mail plausible (le serveur fait foi). */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// --- Affichage --------------------------------------------------------------------------------

/** « brice.237@gmail.com » → « b•••@gmail.com » (planche : « +237 6•• •• •• 41 »). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  return `${email[0] ?? ''}•••${email.slice(at)}`;
}

/** Secondes entières restantes avant `until` (jamais négatif). */
export function secondsUntil(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** 48 → « 0:48 », 75 → « 1:15 ». */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Nom de la ville dans la langue de l'appli (« London » en anglais). */
export function quarterCity(quarter: Pick<Quarter, 'city' | 'cityEn'>, language: 'fr' | 'en'): string {
  return language === 'en' && quarter.cityEn ? quarter.cityEn : quarter.city;
}

/** « Bonamoussadi, Douala » ; une ville seule : « Douala ». */
export function quarterLabel(quarter: Pick<Quarter, 'city' | 'cityEn' | 'name'>, language: 'fr' | 'en'): string {
  const city = quarterCity(quarter, language);
  return quarter.name ? `${quarter.name}, ${city}` : city;
}

// --- Salon trouvé par son code (écran 02, planche Matrice) ---------------------------------

/** found : on peut s'asseoir · full : plus de place (regarder) · playing : partie lancée · closed. */
export type RoomAvailability = 'found' | 'full' | 'playing' | 'closed';

export function roomAvailability(room: Pick<RoomPreview, 'status' | 'seats' | 'seated'>): RoomAvailability {
  if (room.status === 'closed') return 'closed';
  if (room.status === 'playing') return 'playing';
  return room.seated.length >= room.seats ? 'full' : 'found';
}

/** Erreur de la recherche d'un code : inconnu, fermé, pas de réseau, autre. */
export type RoomLookupProblem = 'unknown' | 'closed' | 'offline' | 'error';

export function roomLookupProblem(error: { code: string; status: number }): RoomLookupProblem {
  if (error.code === 'room.closed') return 'closed';
  if (error.code === 'network.offline' || error.code === 'network.timeout') return 'offline';
  // Route absente (serveur plus ancien) ou code inconnu : même message.
  if (error.code === 'room.not_found' || error.status === 404) return 'unknown';
  return 'error';
}

// --- Limitation de débit -----------------------------------------------------------------------

/** Attente demandée par le serveur (`params.retryAfterSeconds` d'une erreur 429), sinon null. */
export function retryAfterSeconds(error: { status: number; params: Readonly<Record<string, unknown>> }): number | null {
  if (error.status !== 429) return null;
  const s = error.params.retryAfterSeconds;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? Math.ceil(s) : 60;
}
