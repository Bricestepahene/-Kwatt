/**
 * Codes d'erreur de la progression : cartes, quêtes, série de jours (écrans 39 et 40).
 */
export const PROGRESSION_ERRORS = [
  /** Carte inconnue, ou pas un habillage de cet emplacement. */
  'cards.not_found',
  /** Carte pas encore gagnée. */
  'cards.not_owned',
  /** Quête inconnue cette semaine. */
  'rewards.quest_not_found',
  /** Quête pas encore terminée. */
  'rewards.quest_not_done',
  /** Récompense déjà récupérée. */
  'rewards.already_claimed',
  /** Aucune carte rare au choix à prendre, ou carte hors du choix proposé. */
  'rewards.no_choice',
] as const;
