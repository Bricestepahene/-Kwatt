/**
 * Écran provisoire : chaque route existe déjà, avec son titre traduit, son bouton
 * retour, sa bande d'espace et un état « en construction » discret. L'équipe
 * propriétaire (ROUTES.md) remplace le fichier de route par son vrai écran.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useDynamicT } from '../i18n';
import { useTheme } from '../theme';
import { Card } from '../ui/Card';
import { SPACE_FABRIC } from '../ui/fabrics/Fabric';
import { Header } from '../ui/Header';
import { Icon } from '../ui/icons/Icon';
import { ListGroup, ListItem } from '../ui/ListItem';
import { formatRoomCode } from '../ui/logic';
import { Screen } from '../ui/Screen';
import { SectionLabel } from '../ui/SectionLabel';
import { Text } from '../ui/Text';
import { buildPath, EXAMPLE_PARAMS, ROUTES_BY_KEY, type RouteKey } from './routes';

/** Paramètres d'URL simples (une valeur par nom). */
function stringParams(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string' && value) out[name] = value;
  }
  return out;
}

/** « M4T-K9Q », « demo » : les segments dynamiques de la route, pour s'y retrouver. */
function describeParams(params: Record<string, string>): string | undefined {
  const values = Object.entries(params)
    .filter(([name]) => name !== 'next')
    .map(([name, value]) => (name === 'code' ? formatRoomCode(value) || value : value));
  return values.length > 0 ? values.join(' · ') : undefined;
}

export interface PlaceholderScreenProps {
  routeKey: RouteKey;
  /** Contenu propre à l'écran, au-dessus de l'état « en construction ». */
  children?: ReactNode;
  /** Bouton de gauche ; par défaut : aucun pour un onglet, retour sinon. */
  leading?: 'back' | 'close' | 'none';
}

export function PlaceholderScreen({ routeKey, children, leading }: PlaceholderScreenProps) {
  const route = ROUTES_BY_KEY[routeKey];
  const { t } = useTranslation('common');
  const td = useDynamicT();
  const { colors } = useTheme();
  const params = stringParams(useLocalSearchParams());
  const isTabRoot = Boolean(route.tab) && route.key !== 'jouer';
  const links = route.links ?? [];

  return (
    <Screen
      space={route.space}
      edges={isTabRoot ? ['top'] : ['top', 'bottom']}
      header={
        <Header
          title={td(`screens:${route.key}.title`)}
          subtitle={describeParams(params)}
          leading={leading ?? (isTabRoot ? 'none' : 'back')}
          large={isTabRoot}
        />
      }
    >
      <Text variant="body" tone="muted">
        {td(`screens:${route.key}.lead`)}
      </Text>

      {children}

      <Card band={SPACE_FABRIC[route.space]} bandHeight={8} border="dashed" gap={8} testID="placeholder-construction">
        <View style={styles.row}>
          <Icon name="hammer" size={20} color={colors.textMuted} />
          <Text variant="subheading">{t('placeholder.title')}</Text>
        </View>
        <Text variant="label" tone="muted">
          {t('placeholder.body')}
        </Text>
        {route.screens.length > 0 ? (
          <Text variant="caption" tone="muted">
            {t('placeholder.ref', { screens: route.screens.join(', '), planches: route.planches.join(', ') })}
          </Text>
        ) : null}
      </Card>

      {links.length > 0 ? (
        <View style={styles.links}>
          <SectionLabel>{t('placeholder.links')}</SectionLabel>
          <ListGroup>
            {links.map((key) => {
              const target = ROUTES_BY_KEY[key as RouteKey];
              return (
                <ListItem
                  key={key}
                  label={td(`screens:${key}.title`)}
                  chevron
                  onPress={() => router.push(buildPath(target.pattern, { ...EXAMPLE_PARAMS, ...params }) as Href)}
                />
              );
            })}
          </ListGroup>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  links: { gap: 10 },
});
