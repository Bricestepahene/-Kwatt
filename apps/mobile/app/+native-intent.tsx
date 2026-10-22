/**
 * Liens reçus du système (kwatt://salon/CODE, https://<domaine>/s/CODE…) : ramenés à un
 * chemin de l'appli avec un code normalisé, avant qu'expo-router ne les ouvre.
 */
import { normalizeIncomingPath } from '@/navigation/deepLinks';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return normalizeIncomingPath(path);
  } catch {
    return path;
  }
}
