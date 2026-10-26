/**
 * Route /ludo/partie/[id] : trouve le contrôleur de la partie (partie locale en mémoire,
 * sinon reprise de la sauvegarde de l'appareil, sinon partie distante créée par la fabrique
 * de l'équipe Parties en ligne : `resolveController('ludo', id)`), puis l'écran de partie.
 * `?spectate=1` : regarder la partie.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { EmptyState, GameBand, LoadingState } from '@/ui';
import { getController, resolveControllerReady, unregisterController } from '../game/registry';
import { LudoGameScreen, type LudoController } from './GameScreen';
import { resumeLocalLudo } from './local/runtime';

export function LudoGameRoute() {
  const { t } = useTranslation('ludo');
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string; spectate?: string }>();
  const id = String(params.id ?? '');
  const [controller, setController] = useState<LudoController | null | undefined>(() => (getController(id) as LudoController | undefined) ?? undefined);

  useEffect(() => {
    let alive = true;
    if (!controller) {
      void (async () => {
        const local = await resumeLocalLudo(id);
        const c = (local as LudoController | undefined) ?? ((await resolveControllerReady('ludo', id, params.spectate === '1' ? { spectate: true } : undefined)) as LudoController | undefined);
        if (alive) setController(c ?? null);
      })();
    }
    return () => {
      alive = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // En quittant l'écran : minuteries arrêtées (la partie locale reste sauvegardée sur l'appareil).
  useEffect(() => () => unregisterController(id), [id]);

  if (controller) return <LudoGameScreen controller={controller} />;
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <GameBand space="ludo" />
      <View style={styles.center}>
        {controller === undefined ? (
          <LoadingState message={t('game.loading')} />
        ) : (
          <EmptyState
            icon="dice"
            title={t('game.notFoundTitle')}
            message={t('game.notFoundMessage')}
            action={{ label: t('game.backToLudo'), onPress: () => router.replace('/jouer/ludo' as Href) }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
});
