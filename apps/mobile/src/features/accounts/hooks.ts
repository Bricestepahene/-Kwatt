/**
 * Crochets React des écrans Comptes : horloge, compte à rebours, saisie différée,
 * disponibilité du pseudo, profil du serveur.
 */
import type { Me, PseudoAvailabilityResponse } from '@kwatt/protocol';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isApiError } from '../../api/errors';
import { useSession } from '../../session';
import { accountKeys, accountsApi } from './api';
import { localPseudoProblem, secondsUntil, type LocalPseudoProblem } from './logic';
import { rememberMe } from './session';

/** Heure courante, rafraîchie toutes les `intervalMs` (comptes à rebours, « il y a 2 min »). */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

/** Secondes restantes avant `until` (ms), 0 quand c'est passé ou sans échéance. */
export function useCountdown(until: number | null): number {
  const now = useNow(1000, until !== null && until > Date.now());
  return until === null ? 0 : secondsUntil(until, now);
}

/** La valeur, une fois que la saisie s'est arrêtée `ms` millisecondes. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export type PseudoCheck =
  | { state: 'idle' }
  | { state: 'invalid'; problem: Exclude<LocalPseudoProblem, null> }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken'; suggestions: string[] }
  | { state: 'banned' }
  | { state: 'offline' };

/**
 * Disponibilité du pseudo en direct (écran 03, changement de pseudo de l'écran 13) :
 * forme vérifiée sur l'appareil, puis GET /v1/auth/pseudo/availability après 400 ms.
 * `current` : le pseudo actuel du joueur (toujours « disponible » pour lui).
 */
export function usePseudoAvailability(pseudo: string, current: string | null = null): PseudoCheck {
  const trimmed = pseudo.trim();
  const problem = localPseudoProblem(trimmed);
  const debounced = useDebounced(trimmed, 400);
  const isCurrent = current !== null && trimmed.toLowerCase() === current.toLowerCase();
  const enabled = problem === null && !isCurrent && debounced === trimmed;
  const query = useQuery<PseudoAvailabilityResponse>({
    queryKey: accountKeys.pseudo(debounced),
    queryFn: ({ signal }) => accountsApi.pseudoAvailability(debounced, signal),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
  if (trimmed.length === 0) return { state: 'idle' };
  if (problem !== null) return { state: 'invalid', problem };
  if (isCurrent) return { state: 'available' };
  if (query.isError) {
    // Pas de réseau : on vérifiera plus tard. Autre refus (trop de demandes) : le serveur tranchera à l'envoi.
    return isApiError(query.error) && query.error.isTransient ? { state: 'offline' } : { state: 'idle' };
  }
  const data = query.data;
  if (!enabled || !data) return { state: 'checking' };
  if (data.available) return { state: 'available' };
  if (data.reason === 'banned') return { state: 'banned' };
  if (data.reason === 'invalid') return { state: 'invalid', problem: 'chars' };
  return { state: 'taken', suggestions: data.suggestions.slice(0, 3) };
}

/** Profil du joueur connecté (GET /v1/me), gardé aussi dans la session. */
export function useMe() {
  const status = useSession((s) => s.status);
  return useQuery<Me>({
    queryKey: accountKeys.me,
    queryFn: async () => {
      const me = await accountsApi.me();
      await rememberMe(me);
      return me;
    },
    enabled: status === 'member' || status === 'guest',
    staleTime: 60_000,
  });
}
