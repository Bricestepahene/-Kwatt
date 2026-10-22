/**
 * États de chaque écran (planche « Réf · Matrice ») : vide, chargement, erreur,
 * hors connexion, et bandeau « Pas de réseau ».
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Platform, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { errorMessage, i18n } from '../i18n';
import { useNetwork } from '../offline/network';
import { useTheme } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './icons/Icon';
import { Text } from './Text';

interface StateAction {
  label: string;
  onPress: () => void;
}

function StateLayout({
  icon,
  title,
  message,
  action,
  compact,
  iconColor,
  children,
  style,
}: {
  icon?: IconName;
  title?: string;
  message?: string;
  action?: StateAction;
  compact?: boolean;
  iconColor?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.layout, compact ? styles.compact : null, style]} accessibilityLiveRegion="polite">
      {children}
      {icon ? (
        <View style={[styles.iconCircle, { backgroundColor: colors.surface }]}>
          <Icon name={icon} size={26} color={iconColor ?? colors.textMuted} />
        </View>
      ) : null}
      {title ? (
        <Text variant="subheading" align="center" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {message ? (
        <Text variant="label" tone="muted" align="center" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} variant="secondary" size="md" style={styles.action} /> : null}
    </View>
  );
}

/** Rien à montrer : « Aucune ligue : rejoins la ligue publique du moment ». */
export function EmptyState(props: { title?: string; message?: string; icon?: IconName; action?: StateAction; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  return (
    <StateLayout
      icon={props.icon ?? 'search'}
      title={props.title ?? t('common:state.empty.title')}
      message={props.message ?? t('common:state.empty.body')}
      action={props.action}
      compact={props.compact}
      style={props.style}
    />
  );
}

/** Chargement : indicateur et phrase (« On cherche le salon… »). */
export function LoadingState({ message, compact, style }: { message?: string; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <StateLayout message={message ?? t('common:state.loading')} compact={compact} style={style}>
      <ActivityIndicator size="large" color={colors.textMuted} accessibilityLabel={message ?? t('common:state.loading')} />
    </StateLayout>
  );
}

/** Erreur : message traduit depuis le code (ApiError) et « Réessayer ». */
export function ErrorState({
  error,
  title,
  message,
  onRetry,
  compact,
  style,
}: {
  error?: unknown;
  title?: string;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const text = message ?? (error ? errorMessage(i18n, error) : t('common:state.error.body'));
  return (
    <StateLayout
      icon="alert"
      iconColor={colors.alert}
      title={title ?? t('common:state.error.title')}
      message={text}
      action={onRetry ? { label: t('common:action.retry'), onPress: onRetry } : undefined}
      compact={compact}
      style={style}
    />
  );
}

/** Hors connexion : « Pas de réseau : le code est gardé, on réessaie ». */
export function OfflineState({ message, onRetry, compact, style }: { message?: string; onRetry?: () => void; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  return (
    <StateLayout
      icon="wifiOff"
      title={t('common:state.offline.title')}
      message={message ?? t('common:state.offline.body')}
      action={onRetry ? { label: t('common:action.retry'), onPress: onRetry } : undefined}
      compact={compact}
      style={style}
    />
  );
}

/** Bloc grisé qui pulse pendant le chargement (« cartes grisées », « vignettes floues »). */
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { colors, reduceMotion } = useTheme();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surface, opacity: pulse }, style]}
    />
  );
}

/**
 * Bandeau réseau : « Pas de réseau : on réessaie tout seul » tant que le réseau manque,
 * puis « Le réseau est revenu » pendant 3 s.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const isOnline = useNetwork((s) => s.isOnline);
  const backOnlineAt = useNetwork((s) => s.backOnlineAt);
  const [showBack, setShowBack] = useState(false);

  useEffect(() => {
    if (!backOnlineAt) return;
    setShowBack(true);
    const timer = setTimeout(() => setShowBack(false), 3000);
    return () => clearTimeout(timer);
  }, [backOnlineAt]);

  if (isOnline === false) {
    return (
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: colors.surfaceStrong, borderColor: colors.alert }]}>
        <Icon name="wifiOff" size={18} color={colors.alert} />
        <Text variant="smallStrong" style={styles.bannerText}>
          {t('common:offline.banner')}
        </Text>
      </View>
    );
  }
  if (showBack) {
    return (
      <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: colors.gainSoft, borderColor: colors.gainBg }]}>
        <Icon name="check" size={18} color={colors.gain} />
        <Text variant="smallStrong" style={[styles.bannerText, { color: colors.gain }]}>
          {t('common:offline.back')}
        </Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  layout: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 24 },
  compact: { paddingVertical: 20 },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  message: { maxWidth: 320 },
  action: { marginTop: 4, alignSelf: 'center', minWidth: 180 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  bannerText: { flexShrink: 1 },
});
