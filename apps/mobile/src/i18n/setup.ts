/**
 * Création de l'instance i18next, sans dépendance à React Native (utilisable dans les tests).
 */
import i18next, { type i18n as I18n, type InitOptions, type Module, type PostProcessorModule, type Resource } from 'i18next';
import { fillPluralGaps, frenchTypography, type Catalog } from './catalogTools';
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './languages';
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resources';

/** Typographie française appliquée après l'interpolation (espaces insécables). */
const typography: PostProcessorModule = {
  type: 'postProcessor',
  name: 'kwattTypography',
  process(value: string, _key: string | string[], _options: unknown, translator: { language?: string }) {
    return translator.language === 'fr' ? frenchTypography(value) : value;
  },
};

/** Catalogues prêts à l'emploi : formes plurielles complétées pour chaque langue. */
export function preparedResources(): Resource {
  const out: Resource = {};
  for (const language of LANGUAGES) {
    const namespaces: Record<string, Catalog> = {};
    for (const ns of NAMESPACES) {
      namespaces[ns] = fillPluralGaps(resources[language][ns] as unknown as Catalog, language);
    }
    out[language] = namespaces;
  }
  return out;
}

export function createI18n(language: Language, plugins: readonly Module[] = [], extra: InitOptions = {}): I18n {
  const instance = i18next.createInstance();
  for (const plugin of plugins) instance.use(plugin);
  instance.use(typography);
  void instance.init({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...LANGUAGES],
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    resources: preparedResources(),
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
    postProcess: ['kwattTypography'],
    ...extra,
  });
  return instance;
}
