import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { textVariants, useTheme, type TextVariant } from '../theme';

/** Couleur du texte, toujours tirée du thème (jamais de couleur en dur dans les écrans). */
export type TextTone = 'default' | 'muted' | 'action' | 'alert' | 'gain' | 'onAction' | 'onInverse';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  align?: 'left' | 'center' | 'right';
}

export function useToneColor(tone: TextTone): string {
  const { colors } = useTheme();
  switch (tone) {
    case 'muted':
      return colors.textMuted;
    case 'action':
      return colors.actionText;
    case 'alert':
      return colors.alert;
    case 'gain':
      return colors.gain;
    case 'onAction':
      return colors.onAction;
    case 'onInverse':
      return colors.onInverse;
    default:
      return colors.text;
  }
}

/** Texte de l'appli : style de la planche (`variant`) et couleur du thème (`tone`). */
export function Text({ variant = 'body', tone = 'default', align, style, ...rest }: TextProps) {
  const color = useToneColor(tone);
  return <RNText {...rest} style={[textVariants[variant], { color }, align ? { textAlign: align } : null, style]} />;
}
