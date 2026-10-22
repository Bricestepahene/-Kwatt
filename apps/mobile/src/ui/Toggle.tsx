import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

/** Interrupteur (cases cochées de la planche Paramètres) : or quand activé. */
export function Toggle({
  value,
  onChange,
  accessibilityLabel,
  disabled,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      accessibilityValue={{ text: value ? t('common:a11y.toggleOn') : t('common:a11y.toggleOff') }}
      onPress={() => onChange(!value)}
      disabled={disabled}
      hitSlop={10}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}
    >
      <View style={[styles.track, { backgroundColor: value ? colors.action : colors.bg, borderColor: value ? colors.action : colors.border }]}>
        <View
          style={[
            styles.knob,
            { backgroundColor: value ? colors.onAction : colors.textMuted, transform: [{ translateX: value ? 20 : 0 }] },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: 50, height: 30, borderRadius: 15, borderWidth: 1, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 11 },
});
