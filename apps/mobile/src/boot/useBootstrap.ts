/**
 * Démarrage de l'appli : préférences et session lues sur l'appareil, langue appliquée,
 * polices chargées ; puis réseau, temps réel, file hors ligne, sons et orientation.
 * L'écran de démarrage natif reste affiché jusqu'à ce que tout soit prêt.
 */
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { startRealtime } from '../api/client';
import { syncLanguageFromPreferences } from '../i18n';
import { startNetworkMonitoring, startOfflineSync } from '../offline';
import { preferencesStore } from '../preferences';
import { sessionStore } from '../session';
import { preloadSounds } from '../sound';
import { useAppFonts } from '../theme';
import { applyOrientationPolicy } from './orientation';

// Le plus tôt possible : garde l'écran de démarrage pendant la lecture de l'appareil.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Lecture des préférences et de la session (une seule fois, même si le composant remonte). */
let hydration: Promise<void> | null = null;

export function hydrateApp(): Promise<void> {
  hydration ??= (async () => {
    await Promise.allSettled([preferencesStore.getState().hydrate(), sessionStore.getState().hydrate()]);
    // Stockage illisible : on démarre sans session plutôt que de rester bloqué.
    if (sessionStore.getState().status === 'loading') sessionStore.setState({ status: 'signedOut', data: null });
    if (!preferencesStore.getState().hydrated) preferencesStore.setState({ hydrated: true });
    await syncLanguageFromPreferences().catch(() => undefined);
  })();
  return hydration;
}

/** Vrai quand l'appli peut s'afficher. */
export function useBootstrap(): boolean {
  const [fontsLoaded, fontError] = useAppFonts();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hydrateApp().then(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Services de fond, démarrés une fois les données de l'appareil lues.
  useEffect(() => {
    if (!hydrated) return;
    const stops = [startNetworkMonitoring(), startRealtime(), startOfflineSync()];
    preloadSounds();
    void applyOrientationPolicy();
    return () => {
      for (const stop of stops) stop();
    };
  }, [hydrated]);

  // Polices en échec : on continue avec celles du système plutôt que de bloquer.
  const ready = hydrated && (fontsLoaded || fontError !== null);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  return ready;
}
