/**
 * Codes d'erreur communs à toute l'API.
 * Le serveur n'envoie jamais de phrase : l'appli traduit chaque code dans la langue de son joueur.
 */
export const COMMON_ERRORS = [
  /** Erreur inattendue côté serveur (le détail est dans le journal du serveur). */
  'common.internal',
  /** Route ou ressource introuvable. */
  'common.not_found',
  /** Entrée refusée par la validation (params.issues : [{ path, code }]). */
  'common.validation',
  /** Requête mal formée (JSON illisible, corps vide…). */
  'common.bad_request',
  /** Trop de requêtes (params.retryAfterSeconds). */
  'common.rate_limited',
  /** Action interdite pour ce compte. */
  'common.forbidden',
  /** Corps de requête trop gros. */
  'common.payload_too_large',
  /** Type de contenu non accepté. */
  'common.unsupported_media_type',
  /** Service momentanément indisponible (base de données injoignable…). */
  'common.unavailable',
] as const;
