/**
 * Les deux couches de la planche « Réf · Variantes du Ludo » :
 * - la forme du plateau (topologie : parcours, cases spéciales) ;
 * - les mécanismes (sortie, capture, protection, barrières, lancer, victoire, équipes).
 * Chaque variante est un préréglage des deux ; les règles maison changent
 * quatre mécanismes dans les limites de la planche, et les combinaisons
 * bloquées sont refusées par un code d'erreur.
 */
import { LudoError, type LudoErrorCode, type LudoErrorParams } from './errors.js';

export type Preset = 'classique' | 'rapide' | 'six' | 'parchis' | 'pachisi';

/**
 * Forme du plateau :
 * - `croix` : croix 15 × 15, 4 maisons, 52 cases ;
 * - `etoile` : étoile à 6 branches, 78 cases ;
 * - `parchis` : croix de 68 cases, couloir de 7 ;
 * - `pachisi` : croix traditionnelle (68 cases autour, colonne du milieu privée à l'aller et au retour).
 */
export type BoardShape = 'croix' | 'etoile' | 'parchis' | 'pachisi';

/** Ce qu'on lance : un dé, ou 6 cauris (Pachisi). */
export type ThrowKind = 'dice' | 'cowries';

/** Sortie de la base : avec un 6 ; un 6 ou un 1 ; un 5 ; premier pion libre puis grâce (6, 10, 25). */
export type ExitRule = 'six' | 'six_or_one' | 'five' | 'grace';
/** Capture : renvoi à la maison ; renvoi et on rejoue ; renvoi et on avance un pion de 20. */
export type CaptureRule = 'home' | 'home_roll_again' | 'home_bonus20';
/** Cases protégées : départs ; étoiles et départs ; 12 cases sûres (Parchís) ; 12 châteaux (Pachisi). */
export type ProtectionRule = 'departs' | 'etoiles_departs' | 'sures' | 'chateaux';
/**
 * Barrières (deux pions de même couleur sur une case : personne ne passe) :
 * interdites ; autorisées ; autorisées et un 6 oblige à ouvrir ; seulement sur les châteaux.
 */
export type BarrierRule = 'none' | 'any' | 'six_opens' | 'castles';

export interface Mechanics {
  tokensPerPlayer: number;
  throw: ThrowKind;
  exit: ExitRule;
  /** Valeurs qui sortent un pion de la base (déduites de `exit`). */
  exitRolls: number[];
  /** Pachisi : le premier pion de chacun sort avec n'importe quel lancer. */
  firstExitFree: boolean;
  /** Parchís : avec un 5, il faut sortir un pion si c'est possible. */
  exitForced: boolean;
  capture: CaptureRule;
  /** Une capture donne un lancer de plus (déduit de `capture`). */
  captureGivesRoll: boolean;
  /** Cases à avancer après une capture (Parchís : 20), 0 sinon. */
  captureBonus: number;
  /** Cases à avancer après avoir rentré un pion (Parchís : 10), 0 sinon. */
  homeBonus: number;
  /** Cases protégées. */
  safeSquares: ProtectionRule;
  /** Un adversaire peut s'arrêter sur une case protégée déjà occupée (faux au Pachisi : château occupé = fermé). */
  safeShared: boolean;
  barriers: BarrierRule;
  /** Dé : un 6 donne un lancer de plus ; trois 6 de suite (`maxSixes`) arrêtent le tour. */
  sixRollsAgain: boolean;
  maxSixes: number;
  /** Trois 6 de suite : le tour passe (`pass`) ou, au Parchís, le dernier pion bougé rentre à la base. */
  thirdSix: 'pass' | 'last_moved_home';
  /** Cauris : une grâce (6, 10, 25) donne un lancer de plus. */
  graceRollsAgain: boolean;
  /** En équipe : celui qui a rentré tous ses pions continue de lancer et joue les pions de son partenaire. */
  partnerPlays: boolean;
}

/** Les quatre réglages modifiables en règles maison (planche 20b, « Personnaliser »). */
export interface HouseRules {
  exit?: ExitRule;
  capture?: CaptureRule;
  protection?: ProtectionRule;
  barriers?: BarrierRule;
}

export interface Config {
  preset: Preset;
  board: BoardShape;
  /** Nombre de maisons dessinées : 4 (croix) ou 6 (étoile). */
  homes: number;
  mechanics: Mechanics;
  /** Équipes : liste des sièges par équipe. Vide = chacun pour soi. */
  teams: number[][];
  /** Règles maison appliquées (seulement les réglages qui diffèrent de la variante), null sinon. */
  house: HouseRules | null;
  /** Durée de la partie (Rapide : 10 min, puis classement à la progression), null sinon. */
  timeLimitMs: number | null;
}

// ---------------------------------------------------------------------------
// Topologie des plateaux
// ---------------------------------------------------------------------------

/**
 * Forme d'un parcours. Chaque maison a sa progression : 0 … `finish`.
 * Les progressions `trackStart` … `lastTrack` sont sur la piste commune ;
 * avant (Pachisi : descente de la colonne du milieu) et après (couloir final),
 * les cases sont privées à la maison.
 *
 * Case absolue d'une progression p sur la piste :
 * (startOffset + maison × block + p − trackStart) mod trackLength.
 */
export interface Topology {
  board: BoardShape;
  homes: number;
  trackLength: number;
  /** Cases de piste entre deux départs consécutifs. */
  block: number;
  /** Case absolue du départ de la maison 0. */
  startOffset: number;
  trackStart: number;
  lastTrack: number;
  finish: number;
  /** Décalages (depuis le départ d'une maison) des cases protégées, par réglage de protection permis. */
  protection: Partial<Record<ProtectionRule, number[]>>;
  /** Décalages des étoiles (croix, étoile) et des châteaux (Pachisi), pour le dessin. */
  stars: number[];
  castles: number[];
}

export const TOPOLOGY: Record<BoardShape, Topology> = {
  croix: {
    board: 'croix', homes: 4, trackLength: 52, block: 13, startOffset: 0, trackStart: 0, lastTrack: 50, finish: 56,
    protection: { departs: [0], etoiles_departs: [0, 8] }, stars: [8], castles: [],
  },
  etoile: {
    board: 'etoile', homes: 6, trackLength: 78, block: 13, startOffset: 0, trackStart: 0, lastTrack: 76, finish: 82,
    protection: { departs: [0], etoiles_departs: [0, 8] }, stars: [8], castles: [],
  },
  // Parchís : numérotation officielle 1 … 68 = case absolue (68 ↔ 0). Sortie de la maison 0 en 5,
  // entrée de son couloir en 68 ; cases sûres 5, 12, 17, 22, 29, 34, 39, 46, 51, 56, 63, 68.
  parchis: {
    board: 'parchis', homes: 4, trackLength: 68, block: 17, startOffset: 5, trackStart: 0, lastTrack: 63, finish: 71,
    protection: { departs: [0], sures: [0, 7, 12] }, stars: [], castles: [],
  },
  // Pachisi : progression 0 … 6 = descente de la colonne du milieu (privée), 7 = bout de la branche
  // (château, sur la piste), 8 … 74 = le tour, 75 … 81 = remontée de la colonne du milieu, 82 = Charkoni.
  pachisi: {
    board: 'pachisi', homes: 4, trackLength: 68, block: 17, startOffset: 0, trackStart: 7, lastTrack: 74, finish: 82,
    protection: { departs: [0], chateaux: [0, 4, 13] }, stars: [], castles: [0, 4, 13],
  },
};

/** Maisons occupées selon le nombre de joueurs : face à face quand c'est possible. */
export const SEATING: Record<BoardShape, Record<number, number[]>> = {
  croix: { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
  etoile: { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] },
  parchis: { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
  pachisi: { 4: [0, 1, 2, 3] },
};

// ---------------------------------------------------------------------------
// Lancers
// ---------------------------------------------------------------------------

/** Valeur d'un lancer de 6 cauris selon le nombre d'ouvertures vers le ciel (écran 21c). */
export const COWRIE_VALUES: readonly number[] = [25, 10, 2, 3, 4, 5, 6];
/** Grâces du Pachisi : sortent un pion et donnent un lancer de plus. */
export const GRACES: readonly number[] = [6, 10, 25];

export function cowrieValue(up: number): number {
  const v = COWRIE_VALUES[up];
  if (v === undefined) throw new LudoError('ludo.roll.invalid_value', { up });
  return v;
}

export function isGrace(value: number): boolean {
  return GRACES.includes(value);
}

/** Loi exacte d'un lancer : valeurs et probabilités (dé : 1/6 chacune ; cauris : loi binomiale B(6, ½)). */
export function throwDistribution(kind: ThrowKind): { value: number; p: number }[] {
  if (kind === 'dice') return [1, 2, 3, 4, 5, 6].map((value) => ({ value, p: 1 / 6 }));
  const binom = [1, 6, 15, 20, 15, 6, 1];
  return COWRIE_VALUES.map((value, up) => ({ value, p: binom[up]! / 64 }));
}

export function isValidThrow(kind: ThrowKind, value: number): boolean {
  return kind === 'dice' ? Number.isInteger(value) && value >= 1 && value <= 6 : COWRIE_VALUES.includes(value);
}

const EXIT_ROLLS: Record<ExitRule, number[]> = { six: [6], six_or_one: [6, 1], five: [5], grace: [6, 10, 25] };

// ---------------------------------------------------------------------------
// Préréglages
// ---------------------------------------------------------------------------

export interface PresetInfo {
  board: BoardShape;
  players: [number, number];
  mechanics: Mechanics;
  /** Tailles d'équipe permises (vide : pas d'équipes). */
  teamSizes: number[];
  /** Équipes obligatoires (Pachisi). */
  teamsRequired: boolean;
  /** Variante classée (force, ligues publiques, mises) quand elle est jouée sans règles maison. */
  ranked: boolean;
  timeLimitMs: number | null;
}

function mechanics(base: Omit<Mechanics, 'exitRolls' | 'captureGivesRoll' | 'captureBonus'>): Mechanics {
  return {
    ...base,
    exitRolls: EXIT_ROLLS[base.exit],
    captureGivesRoll: base.capture === 'home_roll_again',
    captureBonus: base.capture === 'home_bonus20' ? 20 : 0,
  };
}

const CLASSIC_MECHANICS = mechanics({
  tokensPerPlayer: 4, throw: 'dice', exit: 'six', firstExitFree: false, exitForced: false, capture: 'home', homeBonus: 0,
  safeSquares: 'etoiles_departs', safeShared: true, barriers: 'none', sixRollsAgain: true, maxSixes: 3, thirdSix: 'pass',
  graceRollsAgain: false, partnerPlays: false,
});

export const PRESETS: Record<Preset, PresetInfo> = {
  classique: { board: 'croix', players: [2, 4], mechanics: CLASSIC_MECHANICS, teamSizes: [2], teamsRequired: false, ranked: true, timeLimitMs: null },
  rapide: {
    board: 'croix',
    players: [2, 4],
    mechanics: mechanics({ ...CLASSIC_MECHANICS, tokensPerPlayer: 2, exit: 'six_or_one', capture: 'home_roll_again', safeSquares: 'departs' }),
    teamSizes: [],
    teamsRequired: false,
    ranked: true,
    timeLimitMs: 10 * 60 * 1000,
  },
  six: { board: 'etoile', players: [2, 6], mechanics: CLASSIC_MECHANICS, teamSizes: [2, 3], teamsRequired: false, ranked: true, timeLimitMs: null },
  parchis: {
    board: 'parchis',
    players: [2, 4],
    mechanics: mechanics({
      ...CLASSIC_MECHANICS, exit: 'five', exitForced: true, capture: 'home_bonus20', homeBonus: 10, safeSquares: 'sures',
      barriers: 'six_opens', thirdSix: 'last_moved_home', partnerPlays: true,
    }),
    teamSizes: [2],
    teamsRequired: false,
    ranked: false,
    timeLimitMs: null,
  },
  pachisi: {
    board: 'pachisi',
    players: [4, 4],
    mechanics: mechanics({
      ...CLASSIC_MECHANICS, throw: 'cowries', exit: 'grace', firstExitFree: true, capture: 'home_roll_again', safeSquares: 'chateaux',
      safeShared: false, barriers: 'castles', sixRollsAgain: false, graceRollsAgain: true, partnerPlays: true,
    }),
    teamSizes: [2],
    teamsRequired: true,
    ranked: false,
    timeLimitMs: null,
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as Preset[];

/** Préréglage à utiliser pour un Ludo « classique » selon le nombre de joueurs : étoile au-delà de 4. */
export function presetForPlayers(players: number): Preset {
  return players > 4 ? 'six' : 'classique';
}

// ---------------------------------------------------------------------------
// Règles maison
// ---------------------------------------------------------------------------

export interface HouseOptions {
  exit: ExitRule[];
  capture: CaptureRule[];
  protection: ProtectionRule[];
  barriers: BarrierRule[];
}

const ALL_CAPTURES: CaptureRule[] = ['home', 'home_roll_again', 'home_bonus20'];

/** Valeurs permises pour chaque réglage maison, selon le plateau (la première est celle du plateau officiel). */
export const HOUSE_OPTIONS: Record<BoardShape, HouseOptions> = {
  croix: { exit: ['six', 'six_or_one', 'five'], capture: ALL_CAPTURES, protection: ['etoiles_departs', 'departs'], barriers: ['none', 'any', 'six_opens'] },
  etoile: { exit: ['six', 'six_or_one', 'five'], capture: ALL_CAPTURES, protection: ['etoiles_departs', 'departs'], barriers: ['none', 'any', 'six_opens'] },
  parchis: { exit: ['five', 'six', 'six_or_one'], capture: ALL_CAPTURES, protection: ['sures', 'departs'], barriers: ['six_opens', 'any', 'none'] },
  pachisi: { exit: ['grace'], capture: ALL_CAPTURES, protection: ['chateaux', 'departs'], barriers: ['castles', 'none'] },
};

/** Réglages maison d'une variante : valeurs permises et valeur par défaut, pour l'écran 20b. */
export function houseRuleOptions(preset: Preset): { rule: keyof HouseRules; options: string[]; default: string }[] {
  const p = PRESETS[preset];
  const o = HOUSE_OPTIONS[p.board];
  return [
    { rule: 'exit', options: o.exit, default: p.mechanics.exit },
    { rule: 'capture', options: o.capture, default: p.mechanics.capture },
    { rule: 'protection', options: o.protection, default: p.mechanics.safeSquares },
    { rule: 'barriers', options: o.barriers, default: p.mechanics.barriers },
  ];
}

/** Garde seulement les réglages qui changent quelque chose ; null s'il n'en reste aucun. */
export function normalizeHouseRules(preset: Preset, house: HouseRules | null | undefined): HouseRules | null {
  if (!house) return null;
  const m = PRESETS[preset].mechanics;
  const out: HouseRules = {};
  if (house.exit !== undefined && house.exit !== m.exit) out.exit = house.exit;
  if (house.capture !== undefined && house.capture !== m.capture) out.capture = house.capture;
  if (house.protection !== undefined && house.protection !== m.safeSquares) out.protection = house.protection;
  if (house.barriers !== undefined && house.barriers !== m.barriers) out.barriers = house.barriers;
  return Object.keys(out).length > 0 ? out : null;
}

/** Mécanismes d'une variante avec ses règles maison (sans validation : voir `validateSetup`). */
export function buildMechanics(preset: Preset, house: HouseRules | null): Mechanics {
  const base = PRESETS[preset].mechanics;
  if (!house) return base;
  const exit = house.exit ?? base.exit;
  const capture = house.capture ?? base.capture;
  return {
    ...base,
    exit,
    exitRolls: EXIT_ROLLS[exit],
    capture,
    captureGivesRoll: capture === 'home_roll_again',
    captureBonus: capture === 'home_bonus20' ? 20 : 0,
    safeSquares: house.protection ?? base.safeSquares,
    barriers: house.barriers ?? base.barriers,
  };
}

// ---------------------------------------------------------------------------
// Validation de la mise en place
// ---------------------------------------------------------------------------

export interface NewGameOptions {
  preset: Preset;
  players: number;
  /** Équipes (sièges). Obligatoires au Pachisi, interdites en Rapide. */
  teams?: number[][];
  /** Règles maison : la partie devient amicale. */
  house?: HouseRules | null;
  /** Plateau demandé, s'il est choisi à part (refusé s'il ne va pas avec la variante). */
  board?: BoardShape;
  /** Lancer demandé, s'il est choisi à part (dé ou cauris : refusé s'il ne va pas avec la variante). */
  throw?: ThrowKind;
}

export type SetupCheck = { ok: true } | { ok: false; code: LudoErrorCode; params: LudoErrorParams };

function fail(code: LudoErrorCode, params: LudoErrorParams = {}): SetupCheck {
  return { ok: false, code, params };
}

/**
 * Vérifie une mise en place sans lever d'erreur : la même fonction sert à
 * l'appli (griser une option) et au serveur (refuser une partie).
 */
export function validateSetup(options: NewGameOptions): SetupCheck {
  const p = PRESETS[options.preset] as PresetInfo | undefined;
  if (!p) return fail('ludo.setup.unknown_preset', { preset: String(options.preset) });
  const preset = options.preset;
  // Plateau à 6 branches avec le Parchís ou le Pachisi (et toute autre forme qui ne va pas avec la variante).
  if (options.board !== undefined && options.board !== p.board) return fail('ludo.setup.board_incompatible', { preset, board: options.board });
  // Un dé quand le Pachisi lance des cauris, et l'inverse.
  if (options.throw !== undefined && options.throw !== p.mechanics.throw) return fail('ludo.setup.throw_incompatible', { preset, throw: options.throw });
  const players = options.players;
  const [min, max] = p.players;
  if (preset === 'pachisi' && players !== 4) return fail('ludo.setup.pachisi_players', { players });
  if (!Number.isInteger(players) || players < min || players > max) return fail('ludo.setup.players', { preset, min, max });

  const teams = options.teams ?? [];
  if (p.teamsRequired && teams.length === 0) return fail('ludo.setup.pachisi_teams');
  if (teams.length > 0) {
    const team = validateTeams(preset, players, teams);
    if (!team.ok) return team;
  }

  const house = options.house ?? null;
  if (house) {
    const allowed = HOUSE_OPTIONS[p.board];
    const checks: [keyof HouseRules, string | undefined, readonly string[]][] = [
      ['exit', house.exit, allowed.exit],
      ['capture', house.capture, allowed.capture],
      ['protection', house.protection, allowed.protection],
      ['barriers', house.barriers, allowed.barriers],
    ];
    for (const [rule, value, list] of checks) {
      if (value === undefined) continue;
      // Sortie à la grâce sans cauris : c'est un réglage de lancer, refusé comme tel.
      if (rule === 'exit' && (value === 'grace') !== (p.mechanics.throw === 'cowries')) return fail('ludo.setup.throw_incompatible', { preset, exit: value });
      if (!list.includes(value)) return fail('ludo.setup.house_option', { preset, rule, value });
    }
    const m = buildMechanics(preset, house);
    // Barrières avec « sortie seulement au 6 » sans « un 6 ouvre la barrière » : partie bloquée à vie.
    if (m.barriers === 'any' && m.exit === 'six') return fail('ludo.setup.barrier_lock');
  }
  return { ok: true };
}

function validateTeams(preset: Preset, players: number, teams: number[][]): SetupCheck {
  const p = PRESETS[preset];
  if (p.teamSizes.length === 0) return fail('ludo.setup.teams_not_allowed', { preset });
  // Équipes avec un nombre de joueurs impair : combinaison bloquée.
  if (players % 2 === 1) return fail('ludo.setup.teams_odd', { players });
  const size = teams[0]!.length;
  if (!p.teamSizes.includes(size) || teams.some((t) => t.length !== size)) return fail('ludo.setup.teams_size', { sizes: p.teamSizes });
  if (teams.length < 2 || size * teams.length !== players) return fail('ludo.setup.teams_partition');
  const all = teams.flat().sort((a, b) => a - b);
  if (all.some((s, i) => s !== i)) return fail('ludo.setup.teams_partition');
  // Partenaires face à face : maisons régulièrement espacées autour du plateau.
  const homes = SEATING[p.board][players]!;
  const n = TOPOLOGY[p.board].homes;
  for (const t of teams) {
    const hs = t.map((s) => homes[s]!).sort((a, b) => a - b);
    const gap = n / size;
    if (hs.some((h, i) => i > 0 && h - hs[i - 1]! !== gap)) return fail('ludo.setup.teams_facing');
  }
  return { ok: true };
}

/** Une partie aux règles maison, au Parchís ou au Pachisi est amicale : pas de classement, pas de mise, pas de ligue publique. */
export function isRanked(config: Pick<Config, 'preset' | 'house'>): boolean {
  return PRESETS[config.preset].ranked && config.house === null;
}
