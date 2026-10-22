/** Codes d'erreur des fichiers envoyés (photos de profil…). */
export const MEDIA_ERRORS = [
  /** Fichier trop gros (params.maxBytes). */
  'media.too_large',
  /** Format non accepté (params.accepted). */
  'media.unsupported_type',
  /** Aucun fichier dans la requête. */
  'media.missing_file',
] as const;
