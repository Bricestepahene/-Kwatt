/**
 * Liens profonds (SPEC §10) : kwatt://salon/CODE, kwatt://ligue/CODE, kwatt://ami/CODE
 * et https://<domaine>/s/CODE. Ramenés à un chemin de l'appli, code normalisé
 * (« m4t-k9q » → « M4TK9Q »). Module pur, testé par vitest ; utilisé par
 * app/+native-intent.tsx (liens reçus du système) et les écrans qui reçoivent un code.
 */
import { normalizeRoomCode, ROOM_CODE_LENGTH } from '../ui/logic';

export const APP_SCHEME = 'kwatt';

/** Code de salon ou de ligue normalisé s'il est valide, sinon le texte d'origine (l'écran dira « code inconnu »). */
export function normalizeCodeSegment(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // segment mal encodé : on garde tel quel
  }
  const compact = decoded.trim().replace(/[-\s]/g, '');
  const code = normalizeRoomCode(compact);
  return code.length === ROOM_CODE_LENGTH && compact.length === ROOM_CODE_LENGTH ? code : decoded.trim();
}

/** Sépare « /a/b?x=1#y » en chemin et suite (« ?x=1#y »). */
function splitPath(path: string): { pathname: string; rest: string } {
  const index = path.search(/[?#]/);
  return index === -1 ? { pathname: path, rest: '' } : { pathname: path.slice(0, index), rest: path.slice(index) };
}

/**
 * Chemin de l'appli pour un lien reçu (URL complète ou chemin). Les liens inconnus
 * sont rendus tels quels : expo-router affichera « page introuvable ».
 */
export function normalizeIncomingPath(input: string): string {
  let path = input.trim();

  // kwatt://salon/CODE (hôte = premier segment) ou kwatt:///salon/CODE
  const scheme = new RegExp(`^${APP_SCHEME}:(?://)?`, 'i');
  if (scheme.test(path)) {
    path = `/${path.replace(scheme, '').replace(/^\/+/, '')}`;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    // https://domaine/s/CODE, exp://…/--/salon/CODE (Expo Go) : on garde le chemin.
    const withoutOrigin = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
    path = withoutOrigin.replace(/^\/--(?=\/|$)/, '') || '/';
  }
  if (!path.startsWith('/')) path = `/${path}`;

  const { pathname, rest } = splitPath(path);
  const segments = pathname.split('/').filter(Boolean);
  const [head, code, ...tail] = segments;

  if (head && code !== undefined && tail.length === 0) {
    const kind = head.toLowerCase();
    // Lien de partage du web : /s/CODE → salon
    if (kind === 's' || kind === 'salon') return `/salon/${encodeURIComponent(normalizeCodeSegment(code))}${rest}`;
    if (kind === 'ligue') return `/ligue/${encodeURIComponent(normalizeCodeSegment(code))}${rest}`;
    // Le format du code d'ami appartient à l'équipe Communauté : on le transmet tel quel.
    if (kind === 'ami') return `/ami/${encodeURIComponent(decodeSafe(code).trim())}${rest}`;
  }
  return `${pathname || '/'}${rest}`;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Liens à partager (dans l'appli et sur le web). */
export function shareLinks(kind: 'salon' | 'ligue' | 'ami', code: string, webDomain?: string | null): { app: string; web: string | null } {
  const app = `${APP_SCHEME}://${kind}/${encodeURIComponent(code)}`;
  const web = webDomain && kind === 'salon' ? `https://${webDomain}/s/${encodeURIComponent(code)}` : null;
  return { app, web };
}
