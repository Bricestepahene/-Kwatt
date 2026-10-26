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
  /** Réglages refusés (variante, places, cadence, règles maison) : params.reason. */
  'room.invalid_settings',
  /** Réservé à l'hôte du salon (lancer la partie). */
  'room.not_host',
  /** Tu n'es pas dans ce salon. */
  'room.not_member',
  /** Place demandée déjà prise. */
  'room.seat_taken',
  /** Lancer : il manque des joueurs assis (params.min). */
  'room.not_enough_players',
  /** Lancer : tous les joueurs assis ne sont pas prêts. */
  'room.not_ready',
  /** Une partie est déjà en cours dans ce salon. */
  'room.playing',
  /** Inviter : ce joueur n'est pas ton ami, ou il t'a bloqué. */
  'room.invite_refused',
] as const;
