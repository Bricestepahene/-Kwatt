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
import enDames from './locales/en/dames.json';
import enErrors from './locales/en/errors.json';
import enItems from './locales/en/items.json';
import enLeagues from './locales/en/leagues.json';
import enLegal from './locales/en/legal.json';
import enLudo from './locales/en/ludo.json';
import enPreferences from './locales/en/preferences.json';
import enProfile from './locales/en/profile.json';
import enScreens from './locales/en/screens.json';
import enSettings from './locales/en/settings.json';
import frAccounts from './locales/fr/accounts.json';
import frCommon from './locales/fr/common.json';
import frDames from './locales/fr/dames.json';
import frErrors from './locales/fr/errors.json';
import frItems from './locales/fr/items.json';
import frLeagues from './locales/fr/leagues.json';
import frLegal from './locales/fr/legal.json';
import frLudo from './locales/fr/ludo.json';
import frPreferences from './locales/fr/preferences.json';
import frProfile from './locales/fr/profile.json';
import frScreens from './locales/fr/screens.json';
import frSettings from './locales/fr/settings.json';

export const resources = {
  fr: {
    common: frCommon,
    errors: frErrors,
    preferences: frPreferences,
    screens: frScreens,
    profile: frProfile,
    items: frItems,
    accounts: frAccounts,
    settings: frSettings,
    legal: frLegal,
    ludo: frLudo,
    dames: frDames,
    leagues: frLeagues,
  },
  en: {
    common: enCommon,
    errors: enErrors,
    preferences: enPreferences,
    screens: enScreens,
    profile: enProfile,
    items: enItems,
    accounts: enAccounts,
    settings: enSettings,
    legal: enLegal,
    ludo: enLudo,
    dames: enDames,
    leagues: enLeagues,
  },
} as const;

export type Namespace = keyof (typeof resources)['fr'];

export const NAMESPACES = Object.keys(resources.fr) as Namespace[];

export const DEFAULT_NAMESPACE: Namespace = 'common';
