/**
 * Navigation des écrans d'entrée : le paramètre `?next=` (où revenir après la connexion)
 * suit le joueur de Bienvenue à Connexion ou à l'inscription.
 */
import type { Href } from 'expo-router';
import { safeNext } from '../../navigation/access';

/** `?next=` lu dans les paramètres de la route (chemin interne seulement), ou null. */
export function nextParam(params: Readonly<Record<string, string | string[] | undefined>>): string | null {
  const raw = params.next;
  return typeof raw === 'string' ? safeNext(raw, '') || null : null;
}

/** Ajoute `?next=` à un chemin d'entrée. */
export function withNext(path: string, next: string | null): Href {
  if (!next || next === '/') return path as Href;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}next=${encodeURIComponent(next)}` as Href;
}
