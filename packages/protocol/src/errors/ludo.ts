/**
 * Codes d'erreur du Ludo.
 *
 * - `ludo.setup.*`, `ludo.roll.*`, `ludo.move.*`, `ludo.seat.*` : codes de @kwatt/rules-ludo
 *   (LUDO_ERRORS), recopiés ici pour que l'API puisse les renvoyer tels quels (combinaisons
 *   bloquées de la planche « Réf · Variantes », coups refusés). Un test du module serveur
 *   `ludo` vérifie que les deux listes restent identiques.
 * - `ludo.house_rules.*` : jeux de règles maison enregistrés (écran 20b).
 */
export const LUDO_ERRORS = [
  'ludo.setup.unknown_preset',
  'ludo.setup.players',
  'ludo.setup.board_incompatible',
  'ludo.setup.throw_incompatible',
  'ludo.setup.pachisi_players',
  'ludo.setup.pachisi_teams',
  'ludo.setup.teams_not_allowed',
  'ludo.setup.teams_odd',
  'ludo.setup.teams_size',
  'ludo.setup.teams_partition',
  'ludo.setup.teams_facing',
  'ludo.setup.house_option',
  'ludo.setup.barrier_lock',
  'ludo.roll.not_now',
  'ludo.roll.invalid_value',
  'ludo.move.not_now',
  'ludo.move.illegal',
  'ludo.seat.invalid',
  /** Jeu de règles introuvable (ou appartenant à un autre joueur). */
  'ludo.house_rules.not_found',
  /** Tu as déjà un jeu de règles de ce nom. */
  'ludo.house_rules.name_taken',
  /** Trop de jeux de règles enregistrés (params : { max }). */
  'ludo.house_rules.limit',
  /** Aucun réglage ne diffère de la variante : rien à enregistrer. */
  'ludo.house_rules.empty',
] as const;
