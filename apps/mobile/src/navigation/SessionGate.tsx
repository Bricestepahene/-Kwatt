/**
 * Garde de session, posée une fois dans app/_layout.tsx, au-dessus de la pile.
 * Applique `decideAccess` (access.ts) à la route courante : si l'écran n'est pas
 * permis, elle le cache aussitôt et renvoie ailleurs (Bienvenue, Rejoindre, accueil).
 */
import { router, useGlobalSearchParams, usePathname, useSegments, type Href } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { translator } from '../i18n';
import { useAccessSession, useSession } from '../session';
import { useTheme } from '../theme';
import { showToast } from '../ui/Toast';
import { decideAccess, type AccessDecision } from './access';
import { peekAfterSignIn, takeAfterSignIn } from './intent';
import { patternFromSegments, routeForPattern } from './routes';

type GateDecision = AccessDecision | { kind: 'wait' };

/** Décision de la garde pour l'écran courant (aussi utile aux écrans qui veulent la connaître). */
export function useGateDecision(): GateDecision {
  const segments = useSegments();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const status = useSession((s) => s.status);
  const access = useAccessSession();
  const key = segments.join('/');

  return useMemo<GateDecision>(() => {
    if (status === 'loading') return { kind: 'wait' };
    const route = routeForPattern(patternFromSegments(key ? key.split('/') : []));
    return decideAccess(route, access, pathname, params, peekAfterSignIn());
    // `params` change d'identité à chaque rendu : on suit ses valeurs.
  }, [status, access, key, pathname, JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function SessionGate() {
  const decision = useGateDecision();
  const { colors } = useTheme();
  const target = decision.kind === 'redirect' ? decision.to : null;
  const reason = decision.kind === 'redirect' ? decision.reason : null;

  useEffect(() => {
    if (!target) return;
    if (reason === 'already_signed_in') takeAfterSignIn();
    if (reason === 'needs_adult') showToast(translator.t('errors:auth.adult_required'), 'alert');
    router.replace(target as Href);
  }, [target, reason]);

  if (decision.kind === 'allow') return null;
  // Écran non permis (ou session pas encore lue) : on le couvre pendant la redirection.
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
