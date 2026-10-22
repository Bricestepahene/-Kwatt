/**
 * Codes d'erreur des règles du Ludo. Le serveur les renvoie tels quels à
 * l'appli (`{ code, params }`), qui les traduit dans la langue de son joueur :
 * jamais de phrase affichable ici.
 */
export const LUDO_ERRORS = [
  // Mise en place de la partie (combinaisons bloquées de la planche « Réf · Variantes »).
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
  // Pendant la partie.
  'ludo.roll.not_now',
  'ludo.roll.invalid_value',
  'ludo.move.not_now',
  'ludo.move.illegal',
  'ludo.seat.invalid',
] as const;

export type LudoErrorCode = (typeof LUDO_ERRORS)[number];

/** Paramètres d'une erreur : des valeurs simples, jamais du texte à afficher. */
export type LudoErrorParams = Record<string, string | number | boolean | null | number[] | string[]>;

export class LudoError extends Error {
  readonly code: LudoErrorCode;
  readonly params: LudoErrorParams;

  constructor(code: LudoErrorCode, params: LudoErrorParams = {}) {
    super(Object.keys(params).length > 0 ? `${code} ${JSON.stringify(params)}` : code);
    this.name = 'LudoError';
    this.code = code;
    this.params = params;
  }
}

export function isLudoErrorCode(value: unknown): value is LudoErrorCode {
  return typeof value === 'string' && (LUDO_ERRORS as readonly string[]).includes(value);
}
