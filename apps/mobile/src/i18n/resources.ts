/**
 * Catalogues de traduction, un fichier par fonctionnalité et par langue :
 * src/i18n/locales/{fr,en}/<espace de noms>.json.
 *
 * Pour ajouter un espace de noms : créer les DEUX fichiers (fr et en, mêmes clés),
 * puis ajouter une ligne d'import et une entrée dans chaque langue ci-dessous.
 * Le test catalogs.test.ts vérifie la parité des clés et que chaque fichier est déclaré ici.
 */
import enAccounts from './locales/en/accounts.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enLegal from './locales/en/legal.json';
import enPreferences from './locales/en/preferences.json';
import enScreens from './locales/en/screens.json';
import enSettings from './locales/en/settings.json';
import frAccounts from './locales/fr/accounts.json';
import frCommon from './locales/fr/common.json';
import frErrors from './locales/fr/errors.json';
import frLegal from './locales/fr/legal.json';
import frPreferences from './locales/fr/preferences.json';
import frScreens from './locales/fr/screens.json';
import frSettings from './locales/fr/settings.json';

export const resources = {
  fr: {
    common: frCommon,
    errors: frErrors,
    preferences: frPreferences,
    screens: frScreens,
    accounts: frAccounts,
    settings: frSettings,
    legal: frLegal,
  },
  en: {
    common: enCommon,
    errors: enErrors,
    preferences: enPreferences,
    screens: enScreens,
    accounts: enAccounts,
    settings: enSettings,
    legal: enLegal,
  },
} as const;

export type Namespace = keyof (typeof resources)['fr'];

export const NAMESPACES = Object.keys(resources.fr) as Namespace[];

export const DEFAULT_NAMESPACE: Namespace = 'common';
