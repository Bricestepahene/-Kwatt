/**
 * Garde de session : décide si la route courante peut s'afficher, sinon où aller.
 * Règles de la planche « Réf · Matrice » (qui peut faire quoi) et du Sommaire.
 * Module pur, testé par vitest ; le composant SessionGate l'applique.
 */
import { normalizeCodeSegment } from './deepLinks';
import type { RouteSpec } from './routes';

export type SessionStatus = 'signedOut' | 'guest' | 'member';

export interface AccessSession {
  status: SessionStatus;
  /** Profil de 18 ans et plus (mises, pronostics, ligues payantes). */
  isAdult: boolean;
}

export type AccessReason = 'needs_session' | 'needs_member' | 'needs_adult' | 'already_signed_in';

export type AccessDecision = { kind: 'allow' } | { kind: 'redirect'; to: string; reason: AccessReason };

const ALLOW: AccessDecision = { kind: 'allow' };

function withNext(path: string, next: string): string {
  return next && next !== '/' ? `${path}?next=${encodeURIComponent(next)}` : path;
}

/**
 * @param route    route courante (ou `undefined` pour une page inconnue : on laisse
 *                 expo-router afficher « introuvable »)
 * @param session  état de la session
 * @param pathname chemin réel (« /salon/M4TK9Q »), gardé dans `next` pour y revenir
 * @param params   paramètres de la route (ex. `code` d'un salon, `next`)
 * @param afterSignIn destination déclarée par l'écran d'entrée (voir intent.ts)
 */
export function decideAccess(
  route: RouteSpec | undefined,
  session: AccessSession,
  pathname: string,
  params: Readonly<Record<string, string | string[] | undefined>> = {},
  afterSignIn: string | null = null,
): AccessDecision {
  if (!route) return ALLOW;
  const { status } = session;

  switch (route.access) {
    case 'public':
      return ALLOW;

    case 'signedOut': {
      if (status !== 'member') return ALLOW;
      const next = typeof params.next === 'string' ? params.next : undefined;
      return { kind: 'redirect', to: safeNext(afterSignIn ?? next, '/'), reason: 'already_signed_in' };
    }

    case 'guest':
      if (status !== 'signedOut') return ALLOW;
      if (route.key === 'salon') {
        const code = typeof params.code === 'string' ? normalizeCodeSegment(params.code) : '';
        return { kind: 'redirect', to: code ? `/rejoindre?code=${encodeURIComponent(code)}` : '/rejoindre', reason: 'needs_session' };
      }
      return { kind: 'redirect', to: withNext('/bienvenue', pathname), reason: 'needs_session' };

    case 'member':
    case 'adult':
      if (status === 'signedOut') return { kind: 'redirect', to: withNext('/bienvenue', pathname), reason: 'needs_session' };
      if (status === 'guest') return { kind: 'redirect', to: withNext('/bienvenue', pathname), reason: 'needs_member' };
      if (route.access === 'adult' && !session.isAdult) return { kind: 'redirect', to: '/', reason: 'needs_adult' };
      return ALLOW;
  }
}

/**
 * Chemin de retour sûr après connexion (`?next=`) : seulement un chemin interne,
 * jamais une adresse externe (« //exemple.com », « https:… »).
 */
export function safeNext(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f]/.test(next)) {
    return fallback;
  }
  return next;
}
