import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

/**
 * Feuille du bas (planche Connexion, « mot de passe oublié ») : voile sombre, poignée,
 * coins de 28 px. Se ferme avec le voile, le bouton retour d'Android ou Échap (web).
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  accessibilityLabel,
  dismissable = true,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  accessibilityLabel: string;
  /** Faux : seule une action de la feuille la ferme (étape en cours). */
  dismissable?: boolean;
}) {
  const { colors, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : visible ? 240 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, progress, reduceMotion]);

  if (!mounted) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [480, 0] });

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismissable ? onClose : () => undefined} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: progress }]}>
          <Pressable
            style={styles.fill}
            onPress={dismissable ? onClose : undefined}
            accessibilityRole="button"
            accessibilityLabel={t('common:action.close')}
            importantForAccessibility={dismissable ? 'auto' : 'no'}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 12) + 22, transform: [{ translateY }] },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Confirmation (abandon, suppression du compte…) : l'action risquée en haut, « Annuler »
 * en bas, sous le pouce. `onConfirm` peut être asynchrone (bouton en chargement).
 */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <BottomSheet visible={visible} onClose={busy ? () => undefined : onCancel} accessibilityLabel={title}>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      {message ? (
        <Text variant="label" tone="muted">
          {message}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={confirmLabel}
          variant={tone === 'danger' ? 'danger' : 'primary'}
          size={tone === 'danger' ? 'sm' : 'lg'}
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button label={cancelLabel ?? t('common:action.cancel')} variant="secondary" size="lg" disabled={busy} onPress={onCancel} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 14,
    paddingHorizontal: 24,
    gap: 16,
    maxWidth: 640,
    alignSelf: 'center',
    width: '100%',
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3 },
  actions: { gap: 10, marginTop: 4 },
});
