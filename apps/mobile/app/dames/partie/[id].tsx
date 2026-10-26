/**
 * Écrans 16, 16b et 43 · Partie de dames (10×10, 8×8, tablette) : même route, la variante
 * vient de la partie. Partie locale (machine hors connexion, reprise après fermeture de
 * l'appli) ou distante (fabrique de l'équipe Parties en ligne : salon, ligue, pari).
 */
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DamesGameScreen } from '@/features/dames/GameScreen';
import { restoreLocalDames } from '@/features/dames/machineGame';
import type { DamesController } from '@/features/dames/useDamesGame';
import { getController, resolveControllerReady, unregisterController } from '@/features/game/registry';
import { EmptyState, LoadingState, Screen } from '@/ui';

export default function PartieDamesScreen() {
  const { id, spectate } = useLocalSearchParams<{ id: string; spectate?: string }>();
  const { t } = useTranslation('dames');
  const [controller, setController] = useState<DamesController | null>(() => (id ? ((getController(id) as DamesController | undefined) ?? null) : null));
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (controller || !id) return;
    let alive = true;
    void (async () => {
      const local = (await restoreLocalDames(id)) as DamesController | null;
      const c = local ?? ((await resolveControllerReady('dames', id, { spectate: spectate === '1' })) as DamesController | undefined) ?? null;
      if (!alive) return;
      if (c) setController(c);
      else setMissing(true);
    })();
    return () => {
      alive = false;
    };
  }, [id, controller, spectate]);

  // Partie distante : on se désabonne en quittant l'écran (la partie continue sur le serveur).
  useEffect(() => () => {
    if (id && getController(id)?.kind === 'remote') unregisterController(id);
  }, [id]);

  if (controller) return <DamesGameScreen controller={controller} />;
  return (
    <Screen space="dames">
      {missing ? (
        <EmptyState
          icon="alert"
          title={t('game.unavailable')}
          message={t('game.unavailableRemote')}
          action={{ label: t('game.backToDames'), onPress: () => router.replace('/jouer/dames') }}
        />
      ) : (
        <LoadingState />
      )}
    </Screen>
  );
}
