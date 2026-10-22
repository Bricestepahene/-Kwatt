/**
 * Fournisseurs communs à tout l'arbre : zones sûres, langues, cache des données
 * serveur, thème Kwatt (et celui de la navigation), barre d'état, messages brefs.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider, type Theme as NavigationTheme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '../api/client';
import { i18n } from '../i18n';
import { ThemeProvider, useTheme } from '../theme';
import { ToastHost } from '../ui/Toast';

/** Couleurs de la navigation (fond pendant les transitions, en-têtes natifs) tirées du thème. */
function NavigationTheming({ children }: { children: ReactNode }) {
  const { colors, isSun, statusBarStyle } = useTheme();
  const navigationTheme = useMemo<NavigationTheme>(() => {
    const base = isSun ? DefaultTheme : DarkTheme;
    return {
      ...base,
      dark: !isSun,
      colors: {
        ...base.colors,
        primary: colors.action,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.alert,
      },
    };
  }, [colors, isSun]);
  return (
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style={statusBarStyle} />
      {children}
    </NavigationThemeProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <NavigationTheming>
              {children}
              <ToastHost />
            </NavigationTheming>
          </ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
