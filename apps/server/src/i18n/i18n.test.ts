import { describe, expect, it } from 'vitest';
import { catalogs, flatten, flattenKeys, formatDate, localeFromAcceptLanguage, placeholders, t } from './index.js';

describe('i18n du serveur', () => {
  it('fr et en ont exactement les mêmes clés', () => {
    expect(flattenKeys(catalogs.en)).toEqual(flattenKeys(catalogs.fr));
  });

  it('chaque texte a les mêmes paramètres dans les deux langues', () => {
    const fr = flatten(catalogs.fr);
    const en = flatten(catalogs.en);
    for (const [key, text] of Object.entries(fr)) {
      expect({ key, p: placeholders(en[key] ?? '') }).toEqual({ key, p: placeholders(text) });
    }
  });

  it('aucun texte n\'est vide', () => {
    for (const locale of ['fr', 'en'] as const) {
      for (const key of flattenKeys(catalogs[locale])) expect(t(locale, key).trim(), `${locale}:${key}`).not.toBe('');
    }
  });

  it('remplace les paramètres et met les nombres en forme selon la langue', () => {
    expect(t('fr', 'push.quest.completed.body', { amount: 2450 })).toBe('+2 450 cauris pour toi.');
    expect(t('en', 'push.quest.completed.body', { amount: 2450 })).toBe('+2,450 cowries for you.');
  });

  it('échappe le HTML quand on le demande', () => {
    expect(t('fr', 'email.verify.intro', { pseudo: '<b>x</b>' }, { html: true })).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(t('fr', 'email.verify.intro', { pseudo: '<b>x</b>' })).toContain('<b>x</b>');
  });

  it('se replie sur la clé quand le texte manque', () => {
    expect(t('en', 'nope.nope')).toBe('nope.nope');
  });

  it('formate une date dans la langue', () => {
    const d = new Date(Date.UTC(2026, 10, 20));
    expect(formatDate('fr', d)).toBe('20 novembre 2026');
    expect(formatDate('en', d)).toBe('20 November 2026');
  });

  it('choisit la langue d\'après Accept-Language', () => {
    expect(localeFromAcceptLanguage(undefined)).toBe('fr');
    expect(localeFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('de-DE,en;q=0.5,fr;q=0.8')).toBe('fr');
    expect(localeFromAcceptLanguage('de-DE')).toBe('fr');
  });
});
