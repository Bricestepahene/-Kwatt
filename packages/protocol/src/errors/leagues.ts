/**
 * Codes d'erreur des ligues (écrans 27 à 35). Les refus de création et d'inscription
 * viennent de @kwatt/domain (`publicLeagueCreationRefusal`, `leagueJoinRefusal`,
 * `validateBoardRules`).
 */
export const LEAGUE_ERRORS = [
  /** Aucune ligue avec cet identifiant ou ce code. */
  'league.not_found',
  /** Création : un invité ne crée pas de ligue. */
  'league.guest',
  /** Ligue publique : réservée aux 18 ans et plus. */
  'league.underage',
  /** Échelon trop bas (création d'une ligue publique, ou échelon minimum fixé par l'organisateur). */
  'league.rank_too_low',
  'league.places_invalid',
  'league.entry_invalid',
  /** La caution (50 × places) dépasse le solde. */
  'league.caution_above_balance',
  /** Réglages incohérents (poules, qualifiés, journées, dates…) : params.reason. */
  'league.settings_invalid',
  'league.full',
  /** Un invité n'entre que dans une ligue privée gratuite. */
  'league.guest_paid',
  'league.guest_public',
  /** Compte jeune (13–17 ans) : aucune ligue payante. */
  'league.underage_paid',
  'league.insufficient_balance',
  /** Ligue payante : jamais deux comptes du même appareil dans la même ligue. */
  'league.same_device',
  'league.already_member',
  'league.not_member',
  /** Action réservée au créateur de la ligue. */
  'league.not_creator',
  /** Pas possible à cette étape de la ligue (params.status). */
  'league.wrong_status',
  /** Pas assez d'inscrits pour lancer (params.minimum). */
  'league.not_enough_players',
  /** Le créateur ne peut pas quitter sa propre ligue (il l'annule). */
  'league.creator_cannot_leave',
  /** Match introuvable dans cette ligue. */
  'league.match_not_found',
  /** Le joueur ne joue pas ce match. */
  'league.not_in_match',
  /** Heure ou planche : plus possible (match trop proche, déjà joué…). */
  'league.too_late',
  /** Salle du match pas encore ouverte (15 minutes avant l'heure). */
  'league.too_early',
  /** Heure hors des créneaux proposés (18:00, 19:30, 20:00, 21:30). */
  'league.time_invalid',
  /** Choix de planche refusé (pas permise, pas ton tour de choisir…). */
  'league.board_not_allowed',
  /** Le service des parties en ligne ne répond pas : la partie démarrera dès qu'il revient. */
  'league.games_unavailable',
  /** Ligue par équipes : on s'inscrit en créant une équipe ou en rejoignant une équipe. */
  'league.team_required',
  /** Équipe introuvable dans cette ligue. */
  'league.team_not_found',
  /** Cette équipe a déjà tous ses joueurs. */
  'league.team_full',
  /** Une équipe de cette ligue porte déjà ce nom. */
  'league.team_name_taken',
  /** Action réservée au capitaine de l'équipe. */
  'league.not_captain',
  /** Ordre des joueurs refusé : 3 joueurs différents de l'équipe. */
  'league.lineup_invalid',
  /** Pas assez d'équipes complètes pour lancer (params.minimum). */
  'league.not_enough_teams',
  /** Rencontre d'équipes : l'heure est celle de la ligue, elle ne se change pas. */
  'league.team_match_fixed',
  /** Règles de planche : voir @kwatt/domain validateBoardRules. */
  'competition.boards_empty',
  'competition.imposed_single_board',
  'competition.default_not_allowed',
  'competition.board_not_allowed',
] as const;
