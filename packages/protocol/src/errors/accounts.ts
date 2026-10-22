/** Codes d'erreur de l'équipe Comptes : quartiers et nom de partie des invités. */
export const ACCOUNT_ERRORS = [
  /** Quartier inconnu ou retiré de la liste. */
  'quarter.not_found',
  /** Quartier déjà changé cette saison (params.nextChangeAt : début de la saison suivante). */
  'quarter.change_too_soon',
  /** Nom de partie hors des règles : 2 à 20 caractères, lettres, chiffres, espaces, « . _ - ' ». */
  'account.display_name_invalid',
  /** Nom de partie contenant un mot interdit ou réservé. */
  'account.display_name_banned',
] as const;
