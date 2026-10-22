/** Codes d'erreur du profil minimal (/v1/me). Le module Profil ajoute les siens ici ou dans son fichier. */
export const PROFILE_ERRORS = [
  /** Pseudo changé il y a moins de 30 jours (params.nextChangeAt). */
  'profile.pseudo_change_too_soon',
  /** Réglages trop volumineux ou mal formés. */
  'profile.settings_invalid',
  /** Suppression déjà demandée. */
  'profile.deletion_already_requested',
] as const;
