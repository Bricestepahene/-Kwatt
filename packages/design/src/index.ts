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
  /** Barre de navigation du bas (planches Accueil, Profil, Cartes…). */
  tabBar: string;
  /** Voile posé derrière une feuille ou une boîte de dialogue. */
  scrim: string;
  /** Pastilles « inversées » : badges d'échelon, cauris, onglet choisi (ivoire la nuit). */
  inverse: string;
  /** Texte posé sur `inverse`. */
  onInverse: string;
  /** Voile posé sur un tissu pour y écrire (sélecteur d'espace sur la bande obom). */
  overlay: string;
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
  tabBar: '#0B0E26',
  scrim: 'rgba(5,7,22,0.72)',
  inverse: '#F4EEDF',
  onInverse: '#0F1230',
  overlay: 'rgba(15,18,48,0.75)',
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
  // Encre nuit sur l'ambre : 5,4:1 (#FBF6EA ne donnait que 3,2:1, sous le seuil de 4,5:1).
  onAction: '#0F1230',
  actionText: '#8A4F00',
  alert: '#B3261E',
  gain: '#0E6B47',
  gainBg: '#1F9D6B',
  gainSoft: '#D6EFE3',
  board: { light: '#FFF8E6', dark: '#9A6233', frame: '#6E4426' },
  // Compléments (fondation appli) : uniquement des valeurs déjà présentes dans la palette.
  tabBar: '#E9E1CC',
  scrim: 'rgba(15,18,48,0.45)',
  inverse: '#0F1230',
  onInverse: '#FBF6EA',
  overlay: 'rgba(15,18,48,0.75)',
};

/** Les deux thèmes, par nom (réglage Nuit / Plein soleil). */
export const themes = { night, pleinSoleil } as const;
export type ThemeName = keyof typeof themes;

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

// ---------------------------------------------------------------------------
// Compléments de la fondation appli. Toutes les valeurs viennent des planches
// (référence entre parenthèses) : aucune couleur de marque n'est inventée.
// ---------------------------------------------------------------------------

/** Icône du cauri (planche « Réf · Identité », pastille « 2 450 cauris »). */
export const cauri = { shell: '#E8D5A9', stroke: '#6E4426' } as const;

/** Teints de l'avatar composé (écran 10, Studio d'avatar), du plus clair au plus foncé. */
export const avatarSkins = ['#F1C9A0', '#C98E5E', '#9A6239', '#6B3F22', '#3F2414'] as const;

/** Raretés des cartes et des avatars (écrans 11 et 39). */
export const rarity = {
  commune: '#F4EEDF',
  rare: '#3FA7E0',
  epique: '#F2B705',
  legendaire: '#FF8A75',
} as const;
export type Rarity = keyof typeof rarity;

/** Petit damier de la carte « Dames » de l'accueil (écran 07). */
export const miniBoard = { light: '#E8D5A9', dark: '#3B2213' } as const;

/**
 * Géométrie des tissus, reprise des motifs CSS des planches (classes .ndop, .toghu,
 * .kaba, .obom) pour les redessiner en SVG à l'identique.
 */
export const fabricPatterns = {
  /** Dents de loup claires sur indigo, tuile carrée. */
  ndop: { tile: 24, base: '#1D2B6E', motif: 'rgba(244,238,223,0.13)' },
  /** Points or au centre de la tuile, gros points rouges aux coins. */
  toghu: {
    tile: 22,
    base: '#14110F',
    small: { color: '#F2B705', radius: 2.5 },
    large: { color: '#E0442E', radius: 5.5 },
  },
  /** Rayures verticales (largeurs en px), répétées. */
  kaba: {
    stripes: [
      { color: '#E0442E', width: 10 },
      { color: '#F2B705', width: 6 },
      { color: '#1F9D6B', width: 10 },
      { color: '#F4EEDF', width: 3 },
      { color: '#3FA7E0', width: 9 },
    ],
  },
  /** Bois : fil sombre et reflets clairs, légèrement inclinés. */
  obom: {
    base: '#6E4426',
    grains: [
      { color: 'rgba(0,0,0,0.18)', width: 2, period: 7, angle: 8 },
      { color: 'rgba(255,220,170,0.10)', width: 1, period: 11, angle: -3 },
    ],
  },
} as const;
export type FabricName = keyof typeof fabricPatterns;

/** Luminance relative WCAG d'une couleur #RRGGBB. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || m[1] === undefined) throw new Error(`Couleur attendue au format #RRGGBB : ${hex}`);
  const n = Number.parseInt(m[1], 16);
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

/** Rapport de contraste WCAG entre deux couleurs #RRGGBB (de 1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
