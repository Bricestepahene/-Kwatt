import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputInstance, type ViewStyle } from 'react-native';
import { fontFamilies, textVariants, useTheme } from '../theme';
import { formatRoomCode, normalizeDigits, normalizeRoomCode, extractRoomCode, ROOM_CODE_LENGTH } from './logic';
import { Text } from './Text';

/**
 * Code à 6 chiffres reçu par e-mail (planche Connexion, « Entre le code reçu ») :
 * six cases de 56 px ; un seul champ caché reçoit la saisie, le collage et le
 * remplissage automatique du système.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  error,
  autoFocus,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Appelé quand les 6 chiffres sont là. */
  onComplete?: (value: string) => void;
  length?: number;
  error?: string | null;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const input = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  const digits = normalizeDigits(value, length);

  return (
    <View style={[styles.wrap, style]}>
      <Pressable
        onPress={() => input.current?.focus()}
        accessible={false}
        style={styles.row}
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length }, (_, i) => {
          const char = digits[i] ?? '';
          const active = focused && i === Math.min(digits.length, length - 1);
          const strong = Boolean(char) || active;
          return (
            <View
              key={i}
              accessibilityLabel={t('code.digit', { n: i + 1, total: length })}
              style={[
                styles.box,
                {
                  backgroundColor: colors.bg,
                  borderColor: error ? colors.alert : strong ? colors.text : colors.border,
                  borderWidth: strong || error ? 2 : 1,
                },
              ]}
            >
              <Text style={[textVariants.numberLarge, styles.digit]}>{char}</Text>
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={input}
        value={digits}
        onChangeText={(text) => {
          const next = normalizeDigits(text, length);
          onChange(next);
          if (next.length === length) onComplete?.(next);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={length}
        caretHidden
        accessibilityLabel={t('code.otpLabel')}
        accessibilityHint={error ?? undefined}
        style={styles.hiddenInput}
      />
      {error ? (
        <Text variant="small" tone="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Code de salon ou de ligue « ABC-DEF » (planche Rejoindre) : grand champ de 72 px,
 * capitales espacées, sans 0/O/1/I ; un lien kwatt:// collé donne directement le code.
 */
export function RoomCodeInput({
  value,
  onChange,
  onComplete,
  label,
  error,
  autoFocus,
  style,
}: {
  /** Code sans tiret (« M4TK9Q »). */
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  label?: string;
  error?: string | null;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const [focused, setFocused] = useState(false);
  const shown = formatRoomCode(value);

  return (
    <View style={[styles.wrap, style]}>
      <Text variant="smallStrong">{label ?? t('code.roomLabel')}</Text>
      <TextInput
        value={shown}
        onChangeText={(text) => {
          const code = extractRoomCode(text) ?? normalizeRoomCode(text);
          onChange(code);
          if (code.length === ROOM_CODE_LENGTH) onComplete?.(code);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
        accessibilityLabel={label ?? t('code.roomLabel')}
        accessibilityHint={error ?? t('code.roomHint')}
        placeholder="ABC-DEF"
        placeholderTextColor={colors.border}
        selectionColor={colors.action}
        style={[
          styles.roomInput,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: error ? colors.alert : focused || value ? colors.text : colors.border,
            fontFamily: fontFamilies.display[700],
          },
        ]}
      />
      <Text variant="caption" tone={error ? 'alert' : 'muted'} accessibilityLiveRegion="polite">
        {error ?? t('code.roomHint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  box: { flex: 1, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: 22, lineHeight: 28 },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1, top: 0, left: 0 },
  roomInput: {
    height: 72,
    borderRadius: 16,
    borderWidth: 2,
    fontSize: 30,
    letterSpacing: 6,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
