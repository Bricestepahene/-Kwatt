// Clés de traduction typées : `t('common:action.back')` est vérifié à la compilation.
import 'i18next';
import type { resources } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof resources)['fr'];
  }
}
