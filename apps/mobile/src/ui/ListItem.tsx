import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from './icons/Icon';
import { Text, type TextTone } from './Text';

export interface ListItemProps {
  label: string;
  /** Valeur à droite, en gris (« brice_237 », « Plein soleil automatique »). */
  value?: string;
  valueTone?: TextTone;
  /** Élément à droite (interrupteur, curseur, lien). */
  right?: ReactNode;
  /** Texte d'aide sous le libellé. */
  hint?: string;
  icon?: IconName;
  onPress?: () => void;
  /** Flèche « › » quand la ligne ouvre un autre écran. */
  chevron?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/** Ligne de réglage (planche Paramètres) : 48 px minimum, séparée par une bordure. */
export function ListItem({ label, value, valueTone = 'muted', right, hint, icon, onPress, chevron, disabled, accessibilityLabel }: ListItemProps) {
  const { colors } = useTheme();
  const content = (
    <>
      {icon ? <Icon name={icon} size={20} color={colors.textMuted} /> : null}
      <View style={styles.texts}>
        <Text variant="label">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="label" tone={valueTone} style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {chevron ? <Icon name="chevronRight" size={18} color={colors.textMuted} /> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.row, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.row, disabled ? { opacity: 0.45 } : null]}>{content}</View>;
}

/** Groupe de lignes sur une surface arrondie, avec séparateurs entre les lignes. */
export function ListGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.group, { backgroundColor: colors.surface }, style]}>
      {items.map((child, index) => (
        <Fragment key={child.key ?? index}>
          {index > 0 ? <View style={[styles.separator, { backgroundColor: colors.border }]} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  texts: { flex: 1, gap: 2 },
  value: { flexShrink: 1, textAlign: 'right' },
  group: { borderRadius: 14, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth * 2, marginHorizontal: 14 },
});
