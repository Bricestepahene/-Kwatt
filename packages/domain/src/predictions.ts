/**
 * Pronostics des spectateurs (écran 37, D-09).
 *
 * - Spectateurs de 18 ans et plus ; 50 cauris par pronostic, un par partie.
 * - Pari mutuel : le total des pronostics est partagé entre ceux qui ont vu
 *   juste (au cauris inférieur ; les restes vont aux premiers à avoir parié,
 *   un cauris chacun). Kwatt ne prélève rien.
 * - Si tout le monde a parié du même côté, ou si personne n'a vu juste, ou si
 *   la partie est nulle : chacun est remboursé.
 * - Fermés au coup 10 (Dames) ou au tour 10 (Ludo).
 */

export const PREDICTION_STAKE = 50;
export const PREDICTION_CLOSE_AT = 10;

/**
 * Les pronostics sont-ils encore ouverts ?
 * Dames : `ply` = demi-coups déjà joués ; le coup n (notation officielle) commence au
 * demi-coup 2 × (n − 1), donc fermeture à partir du demi-coup 18.
 * Ludo : `round` = numéro du tour en cours (1 = premier tour de table).
 */
export function predictionsOpen(game: { kind: 'dames'; ply: number } | { kind: 'ludo'; round: number }): boolean {
  if (game.kind === 'dames') return game.ply < 2 * (PREDICTION_CLOSE_AT - 1);
  return game.round < PREDICTION_CLOSE_AT;
}

export interface Prediction {
  userId: string;
  /** Camp ou siège pronostiqué (identifiant du joueur qu'on voit gagner). */
  pick: string;
  /** Ordre d'arrivée (pour répartir les restes). */
  order: number;
}

export interface PredictionSettlement {
  outcome: 'paid' | 'refunded';
  reason: 'one_side' | 'no_winner_pick' | 'draw' | null;
  /** Montant versé à chacun (remboursement compris). */
  payouts: Record<string, number>;
}

/** Règlement à la fin de la partie. `winner` = null pour une nulle. */
export function settlePredictions(predictions: readonly Prediction[], winner: string | null): PredictionSettlement {
  const refund = (reason: PredictionSettlement['reason']): PredictionSettlement => ({
    outcome: 'refunded',
    reason,
    payouts: Object.fromEntries(predictions.map((p) => [p.userId, PREDICTION_STAKE])),
  });
  if (predictions.length === 0) return { outcome: 'refunded', reason: 'one_side', payouts: {} };
  if (winner === null) return refund('draw');
  if (new Set(predictions.map((p) => p.pick)).size < 2) return refund('one_side');
  const winners = predictions.filter((p) => p.pick === winner).sort((a, b) => a.order - b.order);
  if (winners.length === 0) return refund('no_winner_pick');
  const pool = predictions.length * PREDICTION_STAKE;
  const each = Math.floor(pool / winners.length);
  let rest = pool - each * winners.length;
  const payouts: Record<string, number> = Object.fromEntries(predictions.map((p) => [p.userId, 0]));
  for (const w of winners) {
    payouts[w.userId] = each + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
  }
  return { outcome: 'paid', reason: null, payouts };
}

/** Répartition affichée (« 62 % Armand ») : pourcentage par choix, arrondi, total 100. */
export function predictionShares(predictions: readonly Prediction[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const p of predictions) counts.set(p.pick, (counts.get(p.pick) ?? 0) + 1);
  const total = predictions.length;
  const out: Record<string, number> = {};
  if (total === 0) return out;
  // Méthode du plus fort reste : la somme fait exactement 100.
  const entries = [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  let given = 0;
  const rests: [string, number][] = [];
  for (const [k, c] of entries) {
    const exact = (c * 100) / total;
    out[k] = Math.floor(exact);
    given += out[k];
    rests.push([k, exact - Math.floor(exact)]);
  }
  rests.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (let i = 0; given < 100; i++, given++) {
    const k = rests[i % rests.length]![0];
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
