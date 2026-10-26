/**
 * Codes d'erreur des parties en ligne (contrat C3), des mises entre joueurs, des défis
 * (écran 26) et des pronostics des spectateurs (écran 37).
 */
export const GAME_ERRORS = [
  /** Aucune partie avec cet identifiant. */
  'game.not_found',
  /** La partie est terminée (ou annulée) : plus de coup, plus de pronostic. */
  'game.over',
  /** Ce n'est pas ton tour (ou tu ne joues pas dans cette partie). */
  'game.not_your_turn',
  /** Tu regardes la partie : un spectateur ne joue pas. */
  'game.not_a_player',
  /** Le numéro d'état envoyé est dépassé : resynchroniser (`game.sync`). */
  'game.stale',
  /** Coup illisible ou illégal (Dames : notation officielle ; Ludo : pion). */
  'game.illegal_move',
  /** Lancer refusé : pas le moment, ou grain de sel illisible. */
  'game.roll_not_now',
  /** Proposer la nulle : une fois tous les 10 coups au plus (params.afterPly). */
  'game.draw_too_soon',
  /** Aucune proposition de nulle en attente. */
  'game.no_draw_offer',
  /** Réaction inconnue. */
  'game.reaction_unknown',
  /** Partie contre la machine sur le serveur : variante, difficulté ou nombre de machines refusé. */
  'game.machine_invalid',
  /** Mise : un invité joue toujours sans mise. */
  'stake.guest',
  /** Mise : réservée aux profils de 18 ans et plus. */
  'stake.underage',
  /** Mise : adresse e-mail à vérifier d'abord. */
  'stake.email_unverified',
  /** Mise : montant invalide (entier positif). */
  'stake.invalid',
  /** Mise au-dessus du plafond : min(25 % du plus petit solde, limite de la table). params.max. */
  'stake.above_cap',
  /** Deux comptes vus sur le même appareil ne misent jamais l'un contre l'autre. */
  'stake.same_device',
  /** Solde insuffisant pour bloquer la mise. */
  'stake.insufficient',
  /** Défi introuvable. */
  'challenge.not_found',
  /** Défi déjà accepté, refusé, annulé ou expiré (2 h). */
  'challenge.closed',
  /** Seul le joueur défié (ou l'auteur d'une contre-proposition) répond. */
  'challenge.not_yours',
  /** On ne se défie pas soi-même. */
  'challenge.self',
  /** Le joueur t'a bloqué (ou tu l'as bloqué) : pas de défi ni d'invitation. */
  'challenge.blocked',
  /** Pronostics : fermés après le coup (Dames) ou le tour (Ludo) 10. */
  'prediction.closed',
  /** Pronostics : un joueur de la partie ne pronostique pas sa propre partie. */
  'prediction.player',
  /** Pronostics : un seul pronostic par partie. */
  'prediction.already',
  /** Pronostics : siège inconnu. */
  'prediction.invalid_seat',
] as const;
