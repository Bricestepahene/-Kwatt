/**
 * Messages brefs en bas de l'écran (« Code copié », « Le réseau est revenu »).
 * `showToast()` s'appelle de n'importe où, même hors d'un composant.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { useTheme } from '../theme';
import { Icon, type IconName } from './icons/Icon';
import { Text } from './Text';

export type ToastTone = 'info' | 'success' | 'alert';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

const toastStore = createStore<{ current: ToastItem | null }>()(() => ({ current: null }));
let nextId = 1;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, tone: ToastTone = 'info', durationMs = 3000): void {
  const item = { id: nextId++, message, tone, durationMs };
  toastStore.setState({ current: item });
  AccessibilityInfo.announceForAccessibility(message);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (toastStore.getState().current?.id === item.id) toastStore.setState({ current: null });
  }, durationMs);
}

export function hideToast(): void {
  toastStore.setState({ current: null });
}

const ICON: Record<ToastTone, IconName> = { info: 'info', success: 'check', alert: 'alert' };

/** À placer une fois, en haut de l'arbre (fait par AppProviders). */
export function ToastHost() {
  const current = useStore(toastStore, (s) => s.current);
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: current ? 1 : 0,
      duration: reduceMotion ? 0 : 180,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [current, opacity, reduceMotion]);

  if (!current) return null;
  const accent = current.tone === 'alert' ? colors.alert : current.tone === 'success' ? colors.gain : colors.text;
  return (
    <View pointerEvents="none" style={[styles.host, { bottom: insets.bottom + 92 }]}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[styles.toast, { backgroundColor: colors.surfaceStrong, borderColor: colors.border, opacity }]}
      >
        <Icon name={ICON[current.tone]} size={18} color={accent} />
        <Text variant="labelStrong" style={styles.text}>
          {current.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 520,
  },
  text: { flexShrink: 1 },
});
