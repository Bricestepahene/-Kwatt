import { useId, useState, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, TextInput, View, type StyleProp, type TextInputInstance, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { fontFamilies, useTheme } from '../theme';
import { IconButton } from './Button';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Message d'erreur (déjà traduit) : bordure corail et texte sous le champ. */
  error?: string | null;
  /** Aide sous le champ (« 8 caractères au moins »). */
  hint?: string;
  /** Champ mot de passe : masqué, avec le bouton afficher / masquer. */
  password?: boolean;
  /** Élément sous le champ, aligné à droite (« Mot de passe oublié ? »). */
  footer?: ReactNode;
  /** Bordure de 2 px de cette couleur (pseudo disponible : vert de la planche Inscription). */
  accent?: string | null;
  style?: StyleProp<ViewStyle>;
  /** Référence du champ (React 19 : `ref` est une prop ordinaire). */
  ref?: Ref<TextInputInstance>;
}

/** Champ de formulaire des planches Connexion et Inscription : étiquette, 52 px, rayon 14. */
export function TextField({
  label,
  error,
  hint,
  password = false,
  footer,
  accent = null,
  style,
  onFocus,
  onBlur,
  editable = true,
  ref,
  ...rest
}: TextFieldProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const nativeId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const borderColor = error ? colors.alert : (accent ?? (focused ? colors.text : colors.border));

  return (
    <View style={[styles.wrap, style]}>
      <Text variant="smallStrong" nativeID={`${nativeId}-label`}>
        {label}
      </Text>
      <View style={[styles.field, { backgroundColor: colors.surface, borderColor, borderWidth: focused || error || accent ? 2 : 1 }]}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${nativeId}-label`}
          accessibilityHint={error ?? hint}
          aria-invalid={Boolean(error)}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.action}
          cursorColor={colors.action}
          secureTextEntry={password && !visible}
          autoCapitalize={password ? 'none' : rest.autoCapitalize}
          autoCorrect={password ? false : rest.autoCorrect}
          editable={editable}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: colors.text, fontFamily: fontFamilies.body[400] }, !editable ? { opacity: 0.6 } : null]}
          {...rest}
        />
        {password ? (
          <IconButton
            icon={visible ? 'eyeOff' : 'eye'}
            tone="plain"
            size={40}
            accessibilityLabel={visible ? t('action.hidePassword') : t('action.showPassword')}
            onPress={() => setVisible((v) => !v)}
          />
        ) : null}
      </View>
      {error ? (
        <Text variant="small" tone="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  field: { minHeight: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4 },
  // Sur le web, pas de contour du navigateur : la bordure du champ montre déjà le focus.
  input: { flex: 1, fontSize: 16, minHeight: 48, paddingVertical: 10, ...(Platform.OS === 'web' ? ({ outlineWidth: 0 } as TextStyle) : null) },
  footer: { alignSelf: 'flex-end' },
});
