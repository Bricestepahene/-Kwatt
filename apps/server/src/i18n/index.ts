/**
 * Textes rendus par le serveur : SEULEMENT les e-mails, les notifications push et la page
 * web de partage (SPEC §4). Tout le reste part en codes, traduits par l'appli.
 *
 * Clés imbriquées (`email.verify.subject`), paramètres `{{nom}}`. Les nombres sont mis en
 * forme selon la langue (« 2 450 » en français, « 2,450 » en anglais).
 * `fr.json` et `en.json` doivent avoir exactement les mêmes clés (test de parité).
 */
import type { Locale } from '@kwatt/protocol';
import en from './en.json' with { type: 'json' };
import fr from './fr.json' with { type: 'json' };

type Catalog = { [key: string]: string | Catalog };

export const catalogs: Record<Locale, Catalog> = { fr, en };

const numberFormats: Record<Locale, Intl.NumberFormat> = {
  fr: new Intl.NumberFormat('fr-FR'),
  en: new Intl.NumberFormat('en-GB'),
};

export type I18nParams = Record<string, string | number | null | undefined>;

function lookup(catalog: Catalog, key: string): string | undefined {
  let node: string | Catalog | undefined = catalog;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function hasKey(locale: Locale, key: string): boolean {
  return lookup(catalogs[locale], key) !== undefined;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/**
 * Texte de `key` dans `locale` (repli sur le français, puis sur la clé elle-même).
 * `html: true` échappe les paramètres (contenu saisi par les joueurs : pseudo…).
 */
export function t(locale: Locale, key: string, params: I18nParams = {}, options: { html?: boolean } = {}): string {
  const raw = lookup(catalogs[locale], key) ?? lookup(catalogs.fr, key) ?? key;
  // Les « {{nom}} » ne contiennent aucun caractère échappé : on peut échapper le gabarit entier.
  const template = options.html ? escapeHtml(raw) : raw;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) return '';
    const s = typeof v === 'number' ? numberFormats[locale].format(v) : v;
    return options.html ? escapeHtml(s) : s;
  });
}

/** Catalogue à plat : clé complète → texte brut (pour le test de parité). */
export function flatten(catalog: Catalog, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(catalog)) {
    const key = prefix === '' ? k : `${prefix}.${k}`;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** Toutes les clés d'un catalogue, triées. */
export function flattenKeys(catalog: Catalog): string[] {
  return Object.keys(flatten(catalog)).sort();
}

/** Paramètres `{{…}}` d'un texte. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? '').sort();
}

/** Date longue dans la langue (« 20 novembre 2026 » / « 20 November 2026 »), en UTC. */
export function formatDate(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

/** Langue préférée d'après l'en-tête Accept-Language (français par défaut). */
export function localeFromAcceptLanguage(header: string | undefined): Locale {
  if (!header) return 'fr';
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...rest] = part.trim().split(';');
      const q = rest.map((r) => r.trim()).find((r) => r.startsWith('q='));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (tag.startsWith('fr')) return 'fr';
    if (tag.startsWith('en')) return 'en';
  }
  return 'fr';
}
