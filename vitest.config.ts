import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'services/*/src/**/*.test.ts',
      'apps/server/src/**/*.test.ts',
      // Logique pure de l'appli (sans React Native) : i18n, données, navigation, préférences.
      'apps/mobile/src/**/*.test.ts',
    ],
  },
});
