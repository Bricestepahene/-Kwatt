import { describe, expect, it } from 'vitest';
import {
  ageBandFor,
  ageFor,
  ageRules,
  clampBirthYear,
  formatCountdown,
  localPseudoProblem,
  looksLikeEmail,
  maskEmail,
  passwordStrength,
  quarterLabel,
  retryAfterSeconds,
  roomAvailability,
  roomLookupProblem,
  secondsUntil,
} from './logic';

describe('solidité du mot de passe', () => {
  it('vide, trop court (moins de 8), trop connu', () => {
    expect(passwordStrength('')).toEqual({ level: 'empty', segments: 0, hint: 'empty' });
    expect(passwordStrength('Ab1!xyz')).toMatchObject({ level: 'tooShort', segments: 1 });
    expect(passwordStrength('motdepasse1')).toMatchObject({ level: 'weak', hint: 'common' });
    expect(passwordStrength('12345678')).toMatchObject({ level: 'weak', hint: 'common' });
    expect(passwordStrength('aaaaaaaaaa')).toMatchObject({ level: 'weak', hint: 'common' });
  });

  it('faible : une seule sorte de caractères', () => {
    expect(passwordStrength('ndolemakala')).toEqual({ level: 'weak', segments: 1, hint: 'mix' });
  });

  it('moyen : deux sortes ; le conseil dit ce qui manque', () => {
    expect(passwordStrength('ndole2026')).toEqual({ level: 'medium', segments: 2, hint: 'symbol' });
    expect(passwordStrength('ndole-makala')).toMatchObject({ level: 'medium', hint: 'digit' });
    expect(passwordStrength('ndole-2026')).toMatchObject({ level: 'medium', hint: 'upper' });
    expect(passwordStrength('Ndole-26')).toMatchObject({ level: 'medium', hint: 'longer' });
  });

  it('solide : longueur et variété', () => {
    expect(passwordStrength('Ndole-Makala26')).toEqual({ level: 'strong', segments: 3, hint: 'strong' });
    expect(passwordStrength('ndole-makala-26')).toMatchObject({ level: 'strong' });
    expect(passwordStrength('ndole makala du dimanche')).toMatchObject({ level: 'strong' });
  });
});

describe('âge (écran 04)', () => {
  it('se calcule comme le serveur : année en cours − année de naissance', () => {
    expect(ageFor(2010, 2026)).toBe(16);
    expect(ageBandFor(12)).toBe('child');
    expect(ageBandFor(13)).toBe('teen');
    expect(ageBandFor(17)).toBe('teen');
    expect(ageBandFor(18)).toBe('adult');
  });

  it('borne le sélecteur entre 1930 et l’année en cours', () => {
    expect(clampBirthYear(1900, 2026)).toBe(1930);
    expect(clampBirthYear(2030, 2026)).toBe(2026);
    expect(clampBirthYear(1990, 2026)).toBe(1990);
  });

  it('reprend les lignes de la planche', () => {
    expect(ageRules('child').map((r) => r.value)).toEqual(['yes', 'no', 'no']);
    expect(ageRules('teen')).toContainEqual({ key: 'stakeVsPlayer', value: 'no' });
    expect(ageRules('teen')).toContainEqual({ key: 'visibleToStrangers', value: 'no' });
    expect(ageRules('adult')).toContainEqual({ key: 'createPublicLeague', value: 'ancien' });
    expect(ageRules('adult')).toHaveLength(5);
  });
});

describe('formulaires', () => {
  it('contrôle la forme du pseudo avant le serveur', () => {
    expect(localPseudoProblem('')).toBe('empty');
    expect(localPseudoProblem('br')).toBe('tooShort');
    expect(localPseudoProblem('brice 237')).toBe('chars');
    expect(localPseudoProblem('brïce')).toBe('chars');
    expect(localPseudoProblem('b'.repeat(21))).toBe('tooLong');
    expect(localPseudoProblem('brice_237')).toBeNull();
  });

  it('reconnaît une adresse plausible', () => {
    expect(looksLikeEmail(' brice@example.com ')).toBe(true);
    expect(looksLikeEmail('brice@example')).toBe(false);
    expect(looksLikeEmail('brice example.com')).toBe(false);
  });

  it('masque l’adresse', () => {
    expect(maskEmail('brice.237@gmail.com')).toBe('b•••@gmail.com');
    expect(maskEmail('a@x.cm')).toBe('a•••@x.cm');
    expect(maskEmail('pas-une-adresse')).toBe('pas-une-adresse');
  });

  it('compte à rebours du renvoi du code', () => {
    expect(secondsUntil(10_500, 10_000)).toBe(1);
    expect(secondsUntil(9_000, 10_000)).toBe(0);
    expect(formatCountdown(48)).toBe('0:48');
    expect(formatCountdown(75)).toBe('1:15');
    expect(formatCountdown(-3)).toBe('0:00');
  });

  it('lit l’attente demandée par le serveur (429)', () => {
    expect(retryAfterSeconds({ status: 429, params: { retryAfterSeconds: 42.2 } })).toBe(43);
    expect(retryAfterSeconds({ status: 429, params: {} })).toBe(60);
    expect(retryAfterSeconds({ status: 401, params: { retryAfterSeconds: 42 } })).toBeNull();
  });
});

describe('quartiers', () => {
  it('quartier et ville, dans la langue de l’appli', () => {
    expect(quarterLabel({ name: 'Bonamoussadi', city: 'Douala', cityEn: null }, 'fr')).toBe('Bonamoussadi, Douala');
    expect(quarterLabel({ name: null, city: 'Londres', cityEn: 'London' }, 'en')).toBe('London');
    expect(quarterLabel({ name: null, city: 'Londres', cityEn: 'London' }, 'fr')).toBe('Londres');
  });
});

describe('salon trouvé par son code (planche Matrice)', () => {
  const seated = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, pseudo: `j${i}`, avatar: null }));

  it('place libre, salon plein, partie lancée, fermé', () => {
    expect(roomAvailability({ status: 'open', seats: 4, seated: seated(3) })).toBe('found');
    expect(roomAvailability({ status: 'open', seats: 2, seated: seated(2) })).toBe('full');
    expect(roomAvailability({ status: 'playing', seats: 4, seated: seated(2) })).toBe('playing');
    expect(roomAvailability({ status: 'closed', seats: 4, seated: seated(0) })).toBe('closed');
  });

  it('code inconnu (même si la route manque), fermé, pas de réseau', () => {
    expect(roomLookupProblem({ code: 'room.not_found', status: 404 })).toBe('unknown');
    expect(roomLookupProblem({ code: 'common.not_found', status: 404 })).toBe('unknown');
    expect(roomLookupProblem({ code: 'room.closed', status: 410 })).toBe('closed');
    expect(roomLookupProblem({ code: 'network.offline', status: 0 })).toBe('offline');
    expect(roomLookupProblem({ code: 'network.server', status: 503 })).toBe('error');
  });
});
