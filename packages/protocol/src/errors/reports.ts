/**
 * Codes d'erreur de « Signaler ou bloquer » (écran 38).
 */
export const REPORT_ERRORS = [
  /** Joueur introuvable. */
  'report.not_found',
  /** On ne se signale pas soi-même, on ne se bloque pas soi-même. */
  'report.self',
  /** Ton signalement précédent de ce joueur attend encore la modération. */
  'report.already_open',
  /** Trop de signalements aujourd'hui (params.max). */
  'report.rate_limited',
] as const;
