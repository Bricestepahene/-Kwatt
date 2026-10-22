/**
 * Table « difficulté → probabilité de victoire du joueur » pour les cotes des
 * paris au Ludo (cote = 0,9 ÷ p, SPEC §7). Valeurs mesurées au banc d'essai
 * (CALIBRATION.md) : le joueur est représenté par l'agent « Ton niveau » (par
 * définition, un joueur de ton niveau gagne une partie sur deux contre lui),
 * face à 1 machine de chaque difficulté, places tournées, lancers communs.
 *
 * À n joueurs (1 joueur contre n − 1 machines), on passe par un modèle de Luce :
 * si p₂ = s / (s + m), alors pₙ = s / (s + (n − 1)·m). Les mesures directes à
 * 4 joueurs de CALIBRATION.md vérifient ce modèle.
 *
 * Fichier régénéré par `pnpm --filter @kwatt/ludo-ai-service calibrate`.
 */
import type { Level } from './types.js';

export type RankedVariant = 'classique' | 'rapide' | 'six';

export interface CalibrationPoint {
  /** Probabilité de victoire du joueur en tête-à-tête (2 joueurs). */
  p2: number;
  /** Intervalle de confiance à 95 % de la mesure. */
  low: number;
  high: number;
  games: number;
}

export interface Calibration {
  reference: string;
  measuredAt: string;
  table: Record<RankedVariant, Record<Level, CalibrationPoint>>;
}

export const CALIBRATION: Calibration = {
  reference: 'ton_niveau@1',
  measuredAt: '2026-10-22',
  table: {
    classique: {
      facile: { p2: 0.9042, low: 0.8603, high: 0.9353, games: 240 },
      moyen: { p2: 0.7458, low: 0.6872, high: 0.7967, games: 240 },
      coriace: { p2: 0.5417, low: 0.4785, high: 0.6036, games: 240 },
      ton_niveau: { p2: 0.5, low: 0.5, high: 0.5, games: 0 },
      fon: { p2: 0.5, low: 0.393, high: 0.607, games: 80 },
    },
    rapide: {
      facile: { p2: 0.7542, low: 0.696, high: 0.8044, games: 240 },
      moyen: { p2: 0.6792, low: 0.6177, high: 0.735, games: 240 },
      coriace: { p2: 0.4833, low: 0.4209, high: 0.5463, games: 240 },
      ton_niveau: { p2: 0.5, low: 0.5, high: 0.5, games: 0 },
      fon: { p2: 0.475, low: 0.3692, high: 0.583, games: 80 },
    },
    six: {
      facile: { p2: 0.975, low: 0.9465, high: 0.9885, games: 240 },
      moyen: { p2: 0.8958, low: 0.8508, high: 0.9284, games: 240 },
      coriace: { p2: 0.6167, low: 0.5538, high: 0.6759, games: 240 },
      ton_niveau: { p2: 0.5, low: 0.5, high: 0.5, games: 0 },
      fon: { p2: 0.65, low: 0.5408, high: 0.7455, games: 80 },
    },
  },
};

/** Bornes de p : jamais de certitude, pour que la cote reste raisonnable. */
const P_MIN = 0.02;
const P_MAX = 0.95;

/**
 * Probabilité que le joueur gagne contre `players − 1` machines de ce niveau
 * (modèle de Luce à partir du tête-à-tête mesuré).
 */
export function playerWinProbability(variant: RankedVariant, players: number, level: Level, calibration: Calibration = CALIBRATION): number {
  if (!Number.isInteger(players) || players < 2) throw new Error('ludo_ai.players');
  const p2 = Math.min(P_MAX, Math.max(P_MIN, calibration.table[variant][level].p2));
  const ratio = (1 - p2) / p2;
  return Math.min(P_MAX, Math.max(P_MIN, 1 / (1 + (players - 1) * ratio)));
}
