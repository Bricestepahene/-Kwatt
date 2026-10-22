/** Codes d'erreur de la machine (C2), de la force (C1) et du problème du jour (19b). */
export const DAMES_ERRORS = [
  /** Partie hors connexion refusée au rejeu : coup illégal ou coup de machine différent (params.ply, params.reason). */
  'machine.invalid_game',
  /** Variante qui n'appartient pas au jeu demandé (params.family, params.variant). */
  'machine.invalid_variant',
  /** Difficulté verrouillée : Fon s'ouvre à l'échelon Chef (params.difficulty, params.requiredRank). */
  'machine.difficulty_locked',
  /** Force visée par la machine trop loin de l'offre du serveur (params.expected). */
  'machine.rating_mismatch',
  /** Ce résultat a déjà été envoyé avec un autre contenu (même clientGameId). */
  'machine.result_conflict',
  /** Pari refusé : pas un multiple de 50, au-dessus du plafond, ou hors connexion (params.reason, params.cap). */
  'machine.invalid_bet',
  /** Le problème demandé n'est pas celui du jour (params.dayKey). */
  'puzzle.wrong_day',
  /** Aucun problème disponible pour cette variante. */
  'puzzle.not_found',
] as const;
