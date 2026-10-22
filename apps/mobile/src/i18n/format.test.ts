import { describe, expect, it } from 'vitest';
import { fillPluralGaps, frenchTypography, interpolationVariables, pluralBase } from './catalogTools';
import {
  fallbackFormatNumber,
  formatCauris,
  formatClock,
  formatDate,
  formatNumber,
  formatRelative,
  formatSigned,
} from './format';
import { intlLocale, isLanguage, pickInitialLanguage } from './languages';
import { createI18n, dynamicTranslator } from './setup';

const NNBSP = ' ';

describe('nombres et cauris', () => {
  it('groupe les milliers selon la langue (« 2 450 » / « 2,450 »)', () => {
    expect(formatNumber(2450, 'fr')).toBe(`2${NNBSP}450`);
    expect(formatNumber(2450, 'fr-CM')).toBe(`2${NNBSP}450`);
    expect(formatNumber(2450, 'en')).toBe('2,450');
    expect(formatCauris(1234567.9, 'fr')).toBe(`1${NNBSP}234${NNBSP}567`);
  });

  it('le repli sans Intl donne le même résultat', () => {
    for (const n of [0, 7, 999, 1000, 2450, 1234567, -2450]) {
      expect(fallbackFormatNumber(n, 'fr')).toBe(formatNumber(n, 'fr'));
      expect(fallbackFormatNumber(n, 'en')).toBe(formatNumber(n, 'en'));
    }
    expect(fallbackFormatNumber(1234.5, 'fr', 1)).toBe(`1${NNBSP}234,5`);
    expect(fallbackFormatNumber(1234.5, 'en', 2)).toBe('1,234.5');
  });

  it('écrit les écarts avec un vrai signe moins', () => {
    expect(formatSigned(200, 'fr')).toBe('+200');
    expect(formatSigned(-12, 'fr')).toBe('−12');
    expect(formatSigned(0, 'en')).toBe('0');
    expect(formatSigned(1500, 'en')).toBe('+1,500');
  });
});

describe('pendule', () => {
  it('arrondit à la seconde supérieure', () => {
    expect(formatClock(228_000)).toBe('3:48');
    expect(formatClock(227_001)).toBe('3:48');
    expect(formatClock(725_000)).toBe('12:05');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('dates', () => {
  const sunday18 = Date.UTC(2026, 10, 15, 18, 0); // dimanche 15 novembre 2026, 18:00 UTC

  it('formate jour et heure selon la langue', () => {
    expect(formatDate(sunday18, 'fr', 'dayTime', 'UTC')).toBe('dimanche 18:00');
    expect(formatDate(sunday18, 'en-GB', 'dayTime', 'UTC')).toBe('Sunday 18:00');
    expect(formatDate(sunday18, 'fr', 'short', 'UTC')).toBe('15 nov.');
    expect(formatDate(sunday18, 'fr', 'long', 'UTC')).toBe('15 novembre 2026');
    expect(formatDate(sunday18, 'fr', 'time', 'UTC')).toBe('18:00');
  });
});

describe('heures relatives', () => {
  const now = Date.UTC(2026, 9, 21, 12, 0);
  const fr = createI18n('fr');
  const en = createI18n('en');
  const tfr = dynamicTranslator(fr).t;
  const ten = dynamicTranslator(en).t;

  it('dit « à l’instant », « il y a 2 min », « hier »…', () => {
    expect(formatRelative(now - 10_000, now, tfr, 'fr')).toBe("à l'instant");
    expect(formatRelative(now - 2 * 60_000, now, tfr, 'fr')).toBe('il y a 2 min');
    expect(formatRelative(now - 3 * 3_600_000, now, tfr, 'fr')).toBe('il y a 3 h');
    expect(formatRelative(now - 26 * 3_600_000, now, tfr, 'fr')).toBe('hier');
    expect(formatRelative(now - 3 * 86_400_000, now, tfr, 'fr')).toBe('il y a 3 jours');
    expect(formatRelative(now - 30 * 86_400_000, now, tfr, 'fr', 'UTC')).toBe('21 sept.');
  });

  it('parle aussi du futur (« dans 2 h »), en anglais aussi', () => {
    expect(formatRelative(now + 2 * 3_600_000, now, tfr, 'fr')).toBe('dans 2 h');
    expect(formatRelative(now + 2 * 3_600_000, now, ten, 'en')).toBe('in 2 h');
    expect(formatRelative(now - 60_000, now, ten, 'en')).toBe('1 min ago');
    expect(formatRelative(now - 86_400_000, now, ten, 'en')).toBe('yesterday');
  });
});

describe('langue initiale (SPEC §4)', () => {
  it('garde le choix enregistré', () => {
    expect(pickInitialLanguage('en', 'fr')).toBe('en');
  });
  it('prend la langue de l’appareil si fr ou en, sinon fr', () => {
    expect(pickInitialLanguage(null, 'en')).toBe('en');
    expect(pickInitialLanguage(undefined, 'en-US')).toBe('en');
    expect(pickInitialLanguage(null, 'fr_CM')).toBe('fr');
    expect(pickInitialLanguage(null, 'de')).toBe('fr');
    expect(pickInitialLanguage('es', null)).toBe('fr');
  });
  it('reconnaît les langues et construit l’étiquette Intl', () => {
    expect(isLanguage('fr')).toBe(true);
    expect(isLanguage('FR')).toBe(false);
    expect(intlLocale('fr', 'cm')).toBe('fr-CM');
    expect(intlLocale('en', null)).toBe('en');
    expect(intlLocale('en', '419')).toBe('en');
  });
});

describe('outils de catalogue', () => {
  it('regroupe les formes plurielles', () => {
    expect(pluralBase('time.minutesAgo_other')).toBe('time.minutesAgo');
    expect(pluralBase('time.justNow')).toBe('time.justNow');
  });
  it('liste les variables d’interpolation', () => {
    expect(interpolationVariables('{{amount}} cauris, {{ count }} et {{amount}}')).toEqual(['amount', 'count']);
  });
  it('complète la forme « many » du français avec « other »', () => {
    const filled = fillPluralGaps({ a: { x_one: 'un', x_other: 'des' } }, 'fr');
    expect(filled).toEqual({ a: { x_one: 'un', x_other: 'des', x_many: 'des' } });
    expect(fillPluralGaps({ x_one: 'one', x_other: 'many' }, 'en')).toEqual({ x_one: 'one', x_other: 'many' });
  });
  it('applique la typographie française', () => {
    expect(frenchTypography('Prêt ? « Oui » : allons-y !')).toBe('Prêt ? « Oui » : allons-y !');
  });
});
