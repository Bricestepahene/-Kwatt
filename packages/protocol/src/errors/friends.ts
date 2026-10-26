/**
 * Codes d'erreur des amis (écran 12, contrat C6).
 */
export const FRIEND_ERRORS = [
  /** Joueur ou code d'ami introuvable (ou invisible pour toi). */
  'friends.not_found',
  /** On ne s'ajoute pas soi-même. */
  'friends.self',
  /** L'un de vous a bloqué l'autre. */
  'friends.blocked',
  /** Trop d'amis (params.max). */
  'friends.limit',
  /** Trop de demandes envoyées en attente (params.max). */
  'friends.too_many_requests',
  /** Aucune demande en attente de ce joueur. */
  'friends.no_request',
] as const;
