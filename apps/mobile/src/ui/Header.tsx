/**
 * En-tête d'écran (planches Paramètres, Rejoindre, Notifications) : bouton retour de
 * 44 px sur surface, titre Unbounded 20 px, élément facultatif à droite.
 */
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { IconButton } from './Button';
import { Text } from './Text';

export interface HeaderProps {
  title?: string;
  /** Ligne sous le titre (« Espace Dames · 10×10 »). */
  subtitle?: string;
  /**
   * Bouton de gauche : `back` (défaut), `close` (feuille, écran modal) ou `none`
   * (racine d'un onglet).
   */
  leading?: 'back' | 'close' | 'none';
  /** Action du bouton de gauche ; par défaut : écran précédent, sinon `fallback`. */
  onBack?: () => void;
  /** Où aller s'il n'y a pas d'écran précédent (lien profond ouvert directement). */
  fallback?: Href;
  /** Élément à droite (bouton icône, solde de cauris). */
  right?: ReactNode;
  /** Grand titre (28 px, 800) des écrans de premier niveau. */
  large?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Retour sûr : écran précédent s'il existe, sinon l'écran de repli. */
export function goBack(fallback: Href = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

export function Header({ title, subtitle, leading = 'back', onBack, fallback = '/', right, large = false, style }: HeaderProps) {
  const { t } = useTranslation('common');
  return (
    <View style={[styles.row, style]}>
      {leading !== 'none' ? (
        <IconButton
          icon={leading === 'close' ? 'close' : 'back'}
          accessibilityLabel={leading === 'close' ? t('action.close') : t('action.back')}
          onPress={onBack ?? (() => goBack(fallback))}
        />
      ) : null}
      <View style={styles.titles}>
        {title ? (
          <Text variant={large ? 'display' : 'title'} accessibilityRole="header" numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="small" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  titles: { flex: 1, gap: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
