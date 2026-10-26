/**
 * Absences et exclusion (planche RegleLigues, écrans 34 et 35).
 *
 * - Exclusion après 2 forfaits de suite ou 3 au total (un double forfait
 *   compte comme un forfait pour chacun des deux absents).
 * - Matchs « joués » par l'exclu = rencontres qui ont un résultat, forfaits
 *   compris (Fotso : 3 joués + 2 forfaits = 5 sur 13 ; Tchoumi : 6 sur 13).
 * - Moins de la moitié : tous ses résultats sont annulés (ceux qui l'ont
 *   battu perdent ces points, ceux qui ont perdu contre lui les récupèrent).
 * - La moitié ou plus : ses résultats restent, ses matchs restants deviennent
 *   des victoires 1–0 pour ses adversaires.
 * - Remboursement : ½ × entrée × matchs restants ÷ matchs totaux.
 */
import { exclusionRefund } from './money.js';
import { forfeitedBy, type MatchRecord } from './standings.js';
import type { Fixture } from './schedule.js';

export const CONSECUTIVE_FORFEITS_FOR_EXCLUSION = 2;
export const TOTAL_FORFEITS_FOR_EXCLUSION = 3;

/** Rencontres d'un joueur, dans l'ordre des journées. */
export function playerMatches(playerId: string, matches: readonly MatchRecord[]): MatchRecord[] {
  return matches.filter((m) => m.home === playerId || m.away === playerId).sort((a, b) => a.round - b.round);
}

/** Le joueur doit-il être exclu ? (2 forfaits de suite, ou 3 au total). */
export function exclusionDue(playerId: string, matches: readonly MatchRecord[]): boolean {
  let run = 0;
  let total = 0;
  for (const m of playerMatches(playerId, matches)) {
    if (forfeitedBy(m).includes(playerId)) {
      run++;
      total++;
      if (run >= CONSECUTIVE_FORFEITS_FOR_EXCLUSION || total >= TOTAL_FORFEITS_FOR_EXCLUSION) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

export interface ExclusionInput {
  excluded: string;
  /** Rencontres qui ont un résultat (toute la ligue). */
  matches: readonly MatchRecord[];
  /** Rencontres prévues et non jouées (toute la ligue). */
  unplayed: readonly Fixture[];
  /** Matchs prévus pour un joueur dans tout le calendrier (13 pour 14 joueurs en aller simple). */
  totalMatches: number;
  entry: number;
}

export interface ExclusionResult {
  policy: 'annulled' | 'kept';
  /** Matchs de l'exclu qui ont un résultat (forfaits compris). */
  elapsed: number;
  remaining: number;
  /** Rencontres après exclusion : annulées retirées, victoires 1–0 ajoutées. */
  matches: MatchRecord[];
  annulled: MatchRecord[];
  awarded: MatchRecord[];
  /** Rencontres non jouées sans l'exclu (pour recomposer le calendrier). */
  unplayed: Fixture[];
  refund: number;
}

export function applyExclusion(input: ExclusionInput): ExclusionResult {
  const { excluded } = input;
  const involves = (m: { home: string; away: string }): boolean => m.home === excluded || m.away === excluded;
  const elapsed = input.matches.filter(involves).length;
  const remaining = Math.max(0, input.totalMatches - elapsed);
  const refund = exclusionRefund(input.entry, remaining, input.totalMatches);
  const unplayed = input.unplayed.filter((f) => !involves(f));
  if (2 * elapsed < input.totalMatches) {
    return {
      policy: 'annulled',
      elapsed,
      remaining,
      matches: input.matches.filter((m) => !involves(m)),
      annulled: input.matches.filter(involves),
      awarded: [],
      unplayed,
      refund,
    };
  }
  const awarded: MatchRecord[] = input.unplayed.filter(involves).map((f) => ({
    round: f.round,
    home: f.home,
    away: f.away,
    outcome: f.home === excluded ? 'away_awarded' : 'home_awarded',
  }));
  return { policy: 'kept', elapsed, remaining, matches: [...input.matches, ...awarded], annulled: [], awarded, unplayed, refund };
}
