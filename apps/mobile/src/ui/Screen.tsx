/**
 * Cadre d'un écran (planches 390 × 844) : fond du thème, zones sûres, marge de 20 px,
 * bande de tissu de l'espace de jeu, bandeau réseau, défilement et clavier.
 *
 *   <Screen header={<Header title={t('parametres.title')} />} space="dames">…</Screen>
 */
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Space } from '../navigation/routes';
import { useTheme } from '../theme';
import { GameBand } from './fabrics/Fabric';
import { OfflineBanner } from './states';

/** Marge latérale des planches. */
export const SCREEN_GUTTER = 20;
/** Largeur de lecture maximale sur tablette (le contenu reste centré). */
export const SCREEN_MAX_WIDTH = 720;

export interface ScreenProps {
  children?: ReactNode;
  /** Contenu défilant (vrai par défaut). Faux : le contenu remplit l'écran (plateau). */
  scroll?: boolean;
  /** Marge de 20 px autour du contenu (vrai par défaut). */
  padded?: boolean;
  /** Espace de jeu : bande de tissu en haut (bois pour les Dames, kaba pour le Ludo). */
  space?: Space | null;
  /** En-tête fixe, au-dessus du contenu (souvent `<Header>`). */
  header?: ReactNode;
  /** Pied fixe, sous le contenu (action principale, au pouce). */
  footer?: ReactNode;
  /**
   * Bords protégés : `top` et `bottom` par défaut ; un écran d'onglet laisse le bas
   * à la barre de navigation (`edges={['top']}`).
   */
  edges?: readonly ('top' | 'bottom')[];
  /** Espace entre les blocs (16 px, comme sur les planches). */
  gap?: number;
  /** Bandeau « Pas de réseau » en haut du contenu (vrai par défaut). */
  offlineBanner?: boolean;
  /** Tirer pour rafraîchir. */
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** Identifiant pour les tests de bout en bout. */
  testID?: string;
}

export function Screen({
  children,
  scroll = true,
  padded = true,
  space = null,
  header,
  footer,
  edges = ['top', 'bottom'],
  gap = 16,
  offlineBanner = true,
  refreshing,
  onRefresh,
  contentStyle,
  testID,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const top = edges.includes('top') ? insets.top : 0;
  const bottom = edges.includes('bottom') ? insets.bottom : 0;
  const gutter = padded ? SCREEN_GUTTER : 0;
  // Sur tablette, le contenu garde une largeur de lecture et se centre.
  const sidePadding = width > SCREEN_MAX_WIDTH + 2 * gutter ? (width - SCREEN_MAX_WIDTH) / 2 : gutter;

  const inner: StyleProp<ViewStyle> = [
    { paddingHorizontal: sidePadding, paddingTop: padded ? 16 : 0, paddingBottom: padded ? 24 : 0, gap },
    contentStyle,
  ];

  const body = (
    <>
      {offlineBanner ? <OfflineBanner /> : null}
      {children}
    </>
  );

  return (
    <View testID={testID} style={[styles.root, { backgroundColor: colors.bg, paddingTop: top }]}>
      {space && space !== 'hub' ? <GameBand space={space} /> : null}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header ? <View style={{ paddingHorizontal: sidePadding, paddingTop: padded ? 16 : 0 }}>{header}</View> : null}
        {scroll ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[styles.grow, inner]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.textMuted} colors={[colors.action]} />
              ) : undefined
            }
          >
            {body}
          </ScrollView>
        ) : (
          <View style={[styles.fill, inner]}>{body}</View>
        )}
        {footer ? (
          <View style={{ paddingHorizontal: sidePadding, paddingTop: 12, paddingBottom: Math.max(bottom, 12) + 8, gap: 10 }}>{footer}</View>
        ) : bottom > 0 ? (
          <View style={{ height: bottom }} />
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
});
