/**
 * Langues dans l'appli : instance i18next, changement instantané, formats.
 *
 *   const { t } = useTranslation('screens');      // react-i18next
 *   const f = useFormat();  f.cauris(2450)        // « 2 450 cauris »
 *   setAppLanguage('en');                         // instantané, gardé sur l'appareil
 */
import 'intl-pluralrules'; // Intl.PluralRules pour les moteurs qui ne l'ont pas (pluriels d'i18next)
import { getLocales } from 'expo-localization';
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { initReactI18next, useTranslation } from 'react-i18next';
import { preferencesStore } from '../preferences';
import {
  formatCauris,
  formatClock,
  formatDate,
  formatNumber,
  formatRelative,
  formatSigned,
  type DateStyle,
} from './format';
import { intlLocale, pickInitialLanguage, type Language } from './languages';
import { createI18n } from './setup';

export * from './languages';
export { errorMessage } from '../api/errors';

function deviceLocale(): { languageCode: string | null; regionCode: string | null } {
  try {
    const first = getLocales()[0];
    return { languageCode: first?.languageCode ?? null, regionCode: first?.regionCode ?? null };
  } catch {
    return { languageCode: null, regionCode: null };
  }
}

const device = deviceLocale();

/** Instance unique de l'appli ; la langue est corrigée dès que les préférences sont lues. */
export const i18n = createI18n(pickInitialLanguage(null, device.languageCode), [initReactI18next], {
  react: { useSuspense: false },
});

function applyDocumentLanguage(language: Language) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = language;
}

/** Langue à utiliser une fois les préférences lues (choix du joueur, sinon appareil, sinon fr). */
export function resolveAppLanguage(): Language {
  return pickInitialLanguage(preferencesStore.getState().prefs.language, device.languageCode);
}

/** Applique la langue enregistrée (au démarrage, après lecture des préférences). */
export async function syncLanguageFromPreferences(): Promise<void> {
  const language = resolveAppLanguage();
  applyDocumentLanguage(language);
  if (i18n.language !== language) await i18n.changeLanguage(language);
}

/**
 * Change la langue tout de suite et la garde sur l'appareil. L'envoi au profil
 * (`profiles.locale`, pour les e-mails et notifications) est fait par l'équipe Comptes.
 */
export async function setAppLanguage(language: Language): Promise<void> {
  preferencesStore.getState().update({ language });
  applyDocumentLanguage(language);
  await i18n.changeLanguage(language);
}

export function currentLanguage(): Language {
  return i18n.language === 'en' ? 'en' : 'fr';
}

/** Formats liés à la langue courante (se recalculent quand elle change). */
export function useFormat() {
  const { t, i18n: instance } = useTranslation();
  const language: Language = instance.language === 'en' ? 'en' : 'fr';
  return useMemo(() => {
    const locale = intlLocale(language, device.regionCode);
    const translate = (key: string, options?: Record<string, unknown>) => t(key as never, options as never) as string;
    return {
      language,
      locale,
      number: (value: number, fractionDigits = 0) => formatNumber(value, locale, fractionDigits),
      /** « 2 450 » */
      caurisAmount: (amount: number) => formatCauris(amount, locale),
      /** « 2 450 cauris » / « 2,450 cowries » */
      cauris: (amount: number) =>
        translate('common:cauris.amount', { count: Math.trunc(amount), amount: formatCauris(amount, locale) }),
      signed: (value: number) => formatSigned(value, locale),
      clock: formatClock,
      date: (date: Date | number, style: DateStyle) => formatDate(date, locale, style),
      relative: (date: Date | number, now: Date | number = Date.now()) => formatRelative(date, now, translate, locale),
    };
  }, [language, t]);
}
