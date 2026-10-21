/**
 * Jetons de design Kwatt, repris des planches « Réf · Identité & design system »,
 * « 00 · Sommaire », « Réf · Audit UX » et « 17 · Mode Plein soleil ».
 * Source unique : l'appli ne doit écrire aucune couleur en dur.
 */

/** Palette de marque (identique dans les deux modes d'affichage). */
export const brand = {
  nuit: '#0F1230',
  ndop: '#1D2B6E',
  raphia: '#F4EEDF',
  orToghu: '#F2B705',
  orToghuHover: '#FFD24A',
  rougeToghu: '#E0442E',
  vertForet: '#1F9D6B',
  bleuWouri: '#3FA7E0',
  obom: '#6E4426',
} as const;

export interface Theme {
  /** Fond de l'écran. */
  bg: string;
  /** Cartes, champs, panneaux (valeur post-audit). */
  surface: string;
  /** En-têtes, badges, puces (ndop). */
  surfaceStrong: string;
  border: string;
  text: string;
  textMuted: string;
  /** Réservé à « agis maintenant » et « à toi ». */
  action: string;
  /** Texte posé sur `action`. */
  onAction: string;
  /** Texte d'accent lisible sur `bg`. */
  actionText: string;
  /** Alertes et pertes (corail, jamais l'or). */
  alert: string;
  /** Gains, texte. */
  gain: string;
  /** Gains, aplats. */
  gainBg: string;
  gainSoft: string;
  board: { light: string; dark: string; frame: string };
}

/** Mode nuit : mode par défaut. */
export const night: Theme = {
  bg: '#0F1230',
  surface: '#20265A',
  surfaceStrong: '#1D2B6E',
  border: '#3D4590',
  text: '#F4EEDF',
  textMuted: '#A9AECF',
  action: '#F2B705',
  onAction: '#0F1230',
  actionText: '#F2B705',
  alert: '#FF8A75',
  gain: '#5FD3A2',
  gainBg: '#1F9D6B',
  gainSoft: '#14382E',
  board: { light: '#F1E2BF', dark: '#A8703F', frame: '#6E4426' },
};

/**
 * Mode Plein soleil (écran 17) : plateau et interface clairs.
 * Valeurs reprises de l'écran 17, sauf `alert`, `gain`, `gainSoft`, `border`
 * et `onAction`, absents des planches : à valider.
 */
export const pleinSoleil: Theme = {
  bg: '#FBF6EA',
  surface: '#E9E1CC',
  surfaceStrong: '#E9E1CC',
  border: '#B9A27A',
  text: '#0F1230',
  textMuted: '#4A4F73',
  action: '#C77700',
  onAction: '#FBF6EA',
  actionText: '#8A4F00',
  alert: '#B3261E',
  gain: '#0E6B47',
  gainBg: '#1F9D6B',
  gainSoft: '#D6EFE3',
  board: { light: '#FFF8E6', dark: '#9A6233', frame: '#6E4426' },
};

/** Pions de dames. */
export const checkers = {
  white: { fill: '#FFFFFF', ring: '#B9A27A' },
  black: { fill: '#14110F', ringNight: '#3A322B', ringSun: '#000000' },
} as const;

/**
 * Couleurs des joueurs du Ludo, chacune doublée d'une forme (audit, point 2) :
 * rouge et vert ne se distinguent pas pour environ 1 homme sur 12.
 */
export const ludoSeats = [
  { id: 'rouge', color: '#E0442E', shape: 'rond' },
  { id: 'vert', color: '#1F9D6B', shape: 'carre' },
  { id: 'jaune', color: '#F2B705', shape: 'losange' },
  { id: 'bleu', color: '#3FA7E0', shape: 'gelule' },
  { id: 'violet', color: '#9B6AE0', shape: 'hexagone' },
  { id: 'orange', color: '#F08A24', shape: 'triangle' },
] as const;

export type LudoSeatColor = (typeof ludoSeats)[number]['id'];

export const fonts = {
  /** Titres, scores, chiffres. */
  display: { family: 'Unbounded', weights: [500, 700, 800] },
  /** Texte, formulaires. */
  body: { family: 'DM Sans', weights: [400, 500, 700] },
} as const;

/** Tissus : motifs dessinés en code, jamais en images. */
export const fabrics = {
  ndop: { use: 'fonds, en-têtes, cartes communes', base: '#1D2B6E', motif: 'rgba(244,238,223,.13)' },
  toghu: { use: 'cartes rares, trophées, victoire', base: '#14110F', dots: ['#F2B705', '#E0442E'] },
  kaba: { use: 'Ludo, fêtes, événements', stripes: ['#E0442E', '#F2B705', '#1F9D6B', '#F4EEDF', '#3FA7E0'] },
  obom: { use: 'plateaux, tables, bois', base: '#6E4426' },
} as const;

/** Ergonomie (planche « Réf · Tailles d'écran »). */
export const layout = {
  minTouch: 48,
  minCheckersCell: 34,
  minTextSize: 14,
  radius: { sm: 8, md: 12, lg: 14, card: 16, sheet: 18 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
} as const;

/** Sons du plateau. */
export const sounds = {
  move: 'balafon',
  capture: 'tam-tam',
  yourTurn: 'nkul',
  victory: 'mvet',
} as const;
