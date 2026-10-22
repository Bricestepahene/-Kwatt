/**
 * Thème de l'appli : Nuit (défaut), Plein soleil, Automatique (SPEC §5, D-04).
 * Automatique = capteur de lumière sur Android (10 000 lux pendant 3 s), sinon le
 * mode clair/sombre du système (iOS, web, Android sans capteur).
 */
import { fabricPatterns, layout, themes, type Theme, type ThemeName } from '@kwatt/design';
import { LightSensor } from 'expo-sensors';
import * as SystemUI from 'expo-system-ui';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Platform, useColorScheme } from 'react-native';
import { usePreferences, type ThemeSetting } from '../preferences';
import { createAutoSunDetector, resolveThemeName } from './autoSun';

export interface AppTheme {
  name: ThemeName;
  /** Réglage choisi par le joueur. */
  setting: ThemeSetting;
  colors: Theme;
  isSun: boolean;
  /** Style de la barre d'état : texte clair la nuit, foncé en plein soleil. */
  statusBarStyle: 'light' | 'dark';
  /** « Réduire les animations » du système. */
  reduceMotion: boolean;
  /** Le réglage Automatique utilise le capteur de lumière (sinon : mode du système). */
  autoUsesSensor: boolean;
  layout: typeof layout;
  fabrics: typeof fabricPatterns;
}

const ThemeContext = createContext<AppTheme | null>(null);

/** Capteur de lumière (Android seulement), actif quand le réglage est Automatique et l'appli au premier plan. */
function useLightSensorSun(enabled: boolean): { available: boolean; isSun: boolean } {
  const [available, setAvailable] = useState(false);
  const [isSun, setIsSun] = useState(false);
  const detector = useRef(createAutoSunDetector());
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    let cancelled = false;
    LightSensor.isAvailableAsync()
      .then((ok) => {
        if (!cancelled) setAvailable(ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled || !available || !active) return;
    LightSensor.setUpdateInterval(500);
    const subscription = LightSensor.addListener(({ illuminance }) => {
      setIsSun(detector.current.update(illuminance, Date.now()));
    });
    return () => subscription.remove();
  }, [enabled, available, active]);

  return { available, isSun };
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduce(value);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const setting = usePreferences((p) => p.theme);
  const systemScheme = useColorScheme();
  const sensor = useLightSensorSun(setting === 'auto');
  const reduceMotion = useReduceMotion();

  const name = resolveThemeName(setting, {
    sensorAvailable: sensor.available,
    sensorSun: sensor.isSun,
    systemScheme,
  });

  const value = useMemo<AppTheme>(
    () => ({
      name,
      setting,
      colors: themes[name],
      isSun: name === 'pleinSoleil',
      statusBarStyle: name === 'pleinSoleil' ? 'dark' : 'light',
      reduceMotion,
      autoUsesSensor: sensor.available,
      layout,
      fabrics: fabricPatterns,
    }),
    [name, setting, reduceMotion, sensor.available],
  );

  // Fond de la fenêtre (derrière les écrans, pendant les transitions) et du document web.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(value.colors.bg).catch(() => undefined);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = value.colors.bg;
      document.documentElement.style.colorScheme = value.isSun ? 'light' : 'dark';
    }
  }, [value.colors.bg, value.isSun]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Thème courant : couleurs (`colors`), réglage, mode Plein soleil, animations réduites. */
export function useTheme(): AppTheme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme() doit être appelé sous <ThemeProvider>.');
  return theme;
}
