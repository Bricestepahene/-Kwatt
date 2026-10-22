import { brand } from '@kwatt/design';
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { textVariants, useTheme } from '../theme';
import { Icon, type IconName } from './icons/Icon';
import { Text } from './Text';

/**
 * - `primary`  : or, « agis maintenant » (une seule action principale par écran) ;
 * - `secondary`: contour ivoire épais (« Rejoindre », « Créer mon profil ») ;
 * - `outline`  : contour discret (« Se déconnecter », « Refuser ») ;
 * - `tonal`    : aplat ndop (« Entrer », « Prendre une photo ») ;
 * - `ghost`    : lien (« Mot de passe oublié ? ») ;
 * - `danger`   : contour rouge, texte corail (« Supprimer le compte »).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'tonal' | 'ghost' | 'danger';
/** Hauteurs des planches : 56 (action d'écran), 52, 48, 36 (petits boutons des notifications). */
export type ButtonSize = 'lg' | 'md' | 'sm' | 'xs';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZES: Record<ButtonSize, { height: number; radius: number; padding: number; text: TextStyle; icon: number }> = {
  lg: { height: 56, radius: 14, padding: 20, text: textVariants.button, icon: 20 },
  md: { height: 52, radius: 14, padding: 18, text: { ...textVariants.button, fontSize: 13 }, icon: 20 },
  sm: { height: 48, radius: 12, padding: 16, text: textVariants.labelStrong, icon: 18 },
  xs: { height: 36, radius: 9, padding: 12, text: { ...textVariants.smallStrong, fontSize: 12 }, icon: 16 },
};

export function Button({
  label,
  variant = 'primary',
  size = 'lg',
  icon,
  iconRight,
  loading = false,
  disabled,
  style,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const s = SIZES[size];
  const inactive = Boolean(disabled) || loading;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string; borderWidth?: number }> = {
    primary: { bg: colors.action, fg: colors.onAction },
    secondary: { bg: 'transparent', fg: colors.text, border: colors.text, borderWidth: 2 },
    outline: { bg: 'transparent', fg: colors.text, border: colors.border, borderWidth: 1 },
    tonal: { bg: colors.surfaceStrong, fg: colors.text },
    ghost: { bg: 'transparent', fg: colors.actionText },
    danger: { bg: 'transparent', fg: colors.alert, border: brand.rougeToghu, borderWidth: 1 },
  };
  const p = palette[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={size === 'xs' ? 6 : undefined}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: s.height,
          borderRadius: s.radius,
          paddingHorizontal: variant === 'ghost' ? 4 : s.padding,
          backgroundColor: p.bg,
          borderColor: p.border ?? 'transparent',
          borderWidth: p.borderWidth ?? 0,
          opacity: disabled && !loading ? 0.45 : pressed ? 0.82 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={s.icon} color={p.fg} /> : null}
          <Text style={[variant === 'ghost' ? styles.ghostText : s.text, { color: p.fg }]} numberOfLines={2} align="center">
            {label}
          </Text>
          {iconRight ? <Icon name={iconRight} size={s.icon} color={p.fg} /> : null}
        </View>
      )}
    </Pressable>
  );
}

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  icon: IconName;
  /** Obligatoire : un bouton sans texte doit dire ce qu'il fait (lecteurs d'écran). */
  accessibilityLabel: string;
  /** Fond : surface (défaut), nuit (posé sur un tissu), aucun. */
  tone?: 'surface' | 'bg' | 'plain';
  /** Pastille corail « à traiter » (notifications). */
  badge?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** Bouton icône de 44 px (zone tactile portée à 48 px), comme le retour des planches. */
export function IconButton({ icon, tone = 'surface', badge = false, size = 44, style, disabled, ...rest }: IconButtonProps) {
  const { colors } = useTheme();
  const bg = tone === 'surface' ? colors.surface : tone === 'bg' ? colors.bg : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={Math.max(0, (48 - size) / 2)}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size, backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
      {...rest}
    >
      <Icon name={icon} size={22} />
      {badge ? <View style={[styles.badge, { backgroundColor: colors.alert }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  ghostText: { ...textVariants.labelStrong, fontSize: 15, lineHeight: 20 },
  iconButton: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5 },
});
