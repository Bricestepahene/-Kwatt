/**
 * Langues de l'appli (SPEC §4) : chaque joueur a la sienne, dans la même partie.
 * Module pur : aucune dépendance à React Native, testé par vitest.
 */

export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'fr';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Langue initiale : celle choisie par le joueur si elle existe, sinon la langue
 * principale de l'appareil si c'est le français ou l'anglais, sinon le français.
 */
export function pickInitialLanguage(saved: unknown, deviceLanguageCode: string | null | undefined): Language {
  if (isLanguage(saved)) return saved;
  const device = deviceLanguageCode?.toLowerCase().split(/[-_]/)[0];
  return isLanguage(device) ? device : DEFAULT_LANGUAGE;
}

/**
 * Étiquette BCP 47 pour Intl : la langue du joueur, avec la région de l'appareil
 * quand elle existe (« fr-CM », « en-GB »), pour les formats de date et d'heure.
 */
export function intlLocale(language: Language, region?: string | null): string {
  const r = region?.trim().toUpperCase();
  return r && /^[A-Z]{2}$/.test(r) ? `${language}-${r}` : language;
}
