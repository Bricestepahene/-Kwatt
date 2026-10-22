/** Codes d'erreur du profil public, de l'avatar et de la photo (écrans 09, 10). */
export const PROFILES_ERRORS = [
  /** Profil introuvable, effacé, en cours de suppression ou invisible pour toi (compte jeune). */
  'profiles.not_found',
  /** Pièce d'avatar ou cadre pas encore à toi : l'appli propose l'achat (params.items : codes, params.price : total). */
  'avatar.not_owned',
  /** Code d'objet inconnu ou mis à la mauvaise place (une tenue en guise de coiffe…) (params.code, params.slot). */
  'avatar.invalid_item',
  /** Mode « photo » demandé sans photo envoyée. */
  'photo.missing',
  /** Image illisible (format inconnu, fichier abîmé, trop petite) (params.minSize). */
  'photo.invalid_image',
  /** Aucune photo en attente ou à modérer pour ce joueur. */
  'photo.not_found',
] as const;
