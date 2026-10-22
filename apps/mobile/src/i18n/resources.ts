/**
 * Catalogues de traduction, un fichier par fonctionnalité et par langue :
 * src/i18n/locales/{fr,en}/<espace de noms>.json.
 *
 * Pour ajouter un espace de noms : créer les DEUX fichiers (fr et en, mêmes clés),
 * puis ajouter une ligne d'import et une entrée dans chaque langue ci-dessous.
 * Le test catalogs.test.ts vérifie la parité des clés et que chaque fichier est déclaré ici.
 */
import enCommon from './locales/en/common.json';
import enDames from './locales/en/dames.json';
import enErrors from './locales/en/errors.json';
import enItems from './locales/en/items.json';
import enPreferences from './locales/en/preferences.json';
import enProfile from './locales/en/profile.json';
import enScreens from './locales/en/screens.json';
import frCommon from './locales/fr/common.json';
import frDames from './locales/fr/dames.json';
import frErrors from './locales/fr/errors.json';
import frItems from './locales/fr/items.json';
import frPreferences from './locales/fr/preferences.json';
import frProfile from './locales/fr/profile.json';
import frScreens from './locales/fr/screens.json';

export const resources = {
  fr: {
    common: frCommon,
    errors: frErrors,
    preferences: frPreferences,
    screens: frScreens,
    profile: frProfile,
    items: frItems,
    dames: frDames,
  },
  en: {
    common: enCommon,
    errors: enErrors,
    preferences: enPreferences,
    screens: enScreens,
    profile: enProfile,
    items: enItems,
    dames: enDames,
  },
} as const;

export type Namespace = keyof (typeof resources)['fr'];

export const NAMESPACES = Object.keys(resources.fr) as Namespace[];

export const DEFAULT_NAMESPACE: Namespace = 'common';
