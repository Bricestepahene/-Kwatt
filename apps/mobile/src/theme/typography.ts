/**
 * Styles de texte relevés sur les planches (390 × 844). Unbounded pour les titres,
 * les chiffres et les boutons d'action ; DM Sans pour le reste.
 */
import type { TextStyle } from 'react-native';
import { fontFamilies } from './fonts';

const display = fontFamilies.display;
const body = fontFamilies.body;

export const textVariants = {
  /** Mot-symbole « kwatt » (Bienvenue : 60 px, 800). */
  hero: { fontFamily: display[800], fontSize: 60, lineHeight: 58, letterSpacing: -2.4 },
  /** Grand titre d'écran (« Rejoindre un salon », « Cartes » : 26–28 px, 800). */
  display: { fontFamily: display[800], fontSize: 28, lineHeight: 32, letterSpacing: -0.5 },
  /** Titre d'en-tête avec bouton retour (« Paramètres » : 20 px, 700). */
  title: { fontFamily: display[700], fontSize: 20, lineHeight: 26 },
  /** Titre de carte, prénom (« Brice ? » : 18 px, 700). */
  heading: { fontFamily: display[700], fontSize: 18, lineHeight: 24 },
  /** Petit titre (« Raisonnement » dans une carte : 16 px, 700). */
  subheading: { fontFamily: display[700], fontSize: 16, lineHeight: 22 },
  /** Chiffres, scores (« 2 450 », « 1 482 » : 18 px, 700). */
  number: { fontFamily: display[700], fontSize: 18, lineHeight: 24 },
  /** Grand chiffre (pendule, mise : 28 px, 800). */
  numberLarge: { fontFamily: display[800], fontSize: 28, lineHeight: 34 },
  /** Libellé de section en capitales (12 px, 700, espacé). */
  section: { fontFamily: body[700], fontSize: 12, lineHeight: 16, letterSpacing: 1.68, textTransform: 'uppercase' },
  /** Texte courant (15–16 px). */
  body: { fontFamily: body[400], fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: body[700], fontSize: 15, lineHeight: 22 },
  /** Texte de ligne, de champ (14 px). */
  label: { fontFamily: body[400], fontSize: 14, lineHeight: 20 },
  labelStrong: { fontFamily: body[700], fontSize: 14, lineHeight: 20 },
  /** Texte secondaire (13 px). */
  small: { fontFamily: body[400], fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: body[700], fontSize: 13, lineHeight: 18 },
  /** Mentions (12 px). */
  caption: { fontFamily: body[400], fontSize: 12, lineHeight: 17 },
  /** Bouton principal (Unbounded 13–14 px, 700). */
  button: { fontFamily: display[700], fontSize: 14, lineHeight: 18 },
  /** Badge d'échelon (« NOTABLE · NIV 17 » : Unbounded 10–11 px, 700, capitales). */
  badge: { fontFamily: display[700], fontSize: 10, lineHeight: 13, letterSpacing: 0.6, textTransform: 'uppercase' },
  /** Libellé de la barre du bas (11 px, 500). */
  tab: { fontFamily: body[500], fontSize: 11, lineHeight: 14 },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof textVariants;

/** Plafond de grossissement des textes du système pour les petits libellés (barre du bas, badges). */
export const COMPACT_FONT_SCALE = 1.4;
