/**
 * Codes d'erreur des salons (contrat partagé : écran 02 de l'équipe Comptes, routes de
 * l'équipe Parties en ligne, qui ajoute les siens ici).
 */
export const ROOM_ERRORS = [
  /** Aucun salon ouvert avec ce code. */
  'room.not_found',
  /** Plus de place à table : on peut regarder à la place. */
  'room.full',
  /** Salon fermé (30 min sans partie, ou fermé par l'hôte). */
  'room.closed',
] as const;
