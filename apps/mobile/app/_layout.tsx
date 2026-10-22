/**
 * Racine de l'appli : fournisseurs (thème, langues, données), démarrage (polices,
 * préférences, session), pile de navigation et garde de session.
 */
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppProviders } from '@/boot/AppProviders';
import { useBootstrap } from '@/boot/useBootstrap';
// Envoi des résultats hors connexion contre la machine (C2), enregistré au démarrage.
import '@/features/game/machineResults';
import { SessionGate } from '@/navigation/SessionGate';
import { ThemeProvider, useTheme } from '@/theme';
import { Logo } from '@/ui/brand';
import { ErrorState } from '@/ui/states';

function RootStack() {
  const { colors, reduceMotion } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: reduceMotion ? 'none' : 'default',
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      {/* Pendant une partie : pas de retour par glissement (l'abandon se confirme). */}
      <Stack.Screen name="dames/partie/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="ludo/partie/[id]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

/** Écran affiché tant que l'appareil n'est pas lu (sur le web, l'écran natif n'existe pas). */
function BootCover() {
  const { colors } = useTheme();
  return (
    <View style={[styles.cover, { backgroundColor: colors.bg }]}>
      <Logo size={112} decorative />
    </View>
  );
}

export default function RootLayout() {
  const ready = useBootstrap();
  return (
    <AppProviders>
      {ready ? (
        <>
          <RootStack />
          <SessionGate />
        </>
      ) : (
        <BootCover />
      )}
    </AppProviders>
  );
}

/** Erreur inattendue dans un écran : message traduit et « Réessayer ». */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ThemeProvider>
      <ErrorFallback error={error} retry={retry} />
    </ThemeProvider>
  );
}

function ErrorFallback({ error, retry }: ErrorBoundaryProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.cover, { backgroundColor: colors.bg }]}>
      <ErrorState error={error} onRetry={() => void retry()} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
