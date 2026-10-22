/**
 * Outils purs sur les catalogues de traduction : aplatir les clés, compléter les
 * formes plurielles, typographie française. Testés par vitest.
 */

export type Catalog = { [key: string]: string | Catalog };

/** Suffixes de pluriel d'i18next (format JSON v4, règles CLDR). */
export const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'] as const;

/** Catégories de pluriel exigées par langue (CLDR) : le français a « many » (1 000 000…). */
export const PLURAL_CATEGORIES: Record<string, readonly string[]> = {
  fr: ['one', 'many', 'other'],
  en: ['one', 'other'],
};

/** Clés aplaties « a.b.c » → valeur. */
export function flattenCatalog(catalog: Catalog, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flattenCatalog(value, path));
  }
  return out;
}

/** « time.minutesAgo_other » → « time.minutesAgo » (la base commune aux formes plurielles). */
export function pluralBase(key: string): string {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
}

/** Variables d'interpolation d'une phrase : « {{count}} cauris » → ['count']. */
export function interpolationVariables(value: string): string[] {
  const names = new Set<string>();
  for (const match of value.matchAll(/\{\{\s*([\w.]+)(?:\s*,[^}]*)?\s*\}\}/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names].sort();
}

/**
 * Complète les formes plurielles manquantes avec la forme « other » (ex. `_many` en
 * français), pour que chaque équipe n'écrive que `_one` et `_other`.
 * Renvoie une copie ; le catalogue d'origine n'est pas modifié.
 */
export function fillPluralGaps(catalog: Catalog, language: string): Catalog {
  const categories = PLURAL_CATEGORIES[language] ?? ['one', 'other'];
  const copy: Catalog = {};
  for (const [key, value] of Object.entries(catalog)) {
    copy[key] = typeof value === 'string' ? value : fillPluralGaps(value, language);
  }
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== 'string' || !key.endsWith('_other')) continue;
    const base = key.slice(0, -'_other'.length);
    for (const category of categories) {
      const sibling = `${base}_${category}`;
      if (!(sibling in copy)) copy[sibling] = value;
    }
  }
  return copy;
}

/**
 * Typographie française : espace insécable avant « ? ! : ; » et « » », après « « »,
 * pour qu'une ponctuation ne passe jamais seule à la ligne.
 */
export function frenchTypography(value: string): string {
  return value.replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');
}
