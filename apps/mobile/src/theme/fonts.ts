/**
 * Polices de la planche « Réf · Identité » : Unbounded 500/700/800 (titres, scores,
 * chiffres) et DM Sans 400/500/700 (texte). Seules ces graisses sont embarquées.
 */
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { Unbounded_500Medium } from '@expo-google-fonts/unbounded/500Medium';
import { Unbounded_700Bold } from '@expo-google-fonts/unbounded/700Bold';
import { Unbounded_800ExtraBold } from '@expo-google-fonts/unbounded/800ExtraBold';
import { useFonts } from 'expo-font';

/** Noms de familles enregistrés (en React Native, une graisse = une famille). */
export const fontFamilies = {
  display: {
    500: 'Unbounded_500Medium',
    700: 'Unbounded_700Bold',
    800: 'Unbounded_800ExtraBold',
  },
  body: {
    400: 'DMSans_400Regular',
    500: 'DMSans_500Medium',
    700: 'DMSans_700Bold',
  },
} as const;

const fontAssets = {
  [fontFamilies.display[500]]: Unbounded_500Medium,
  [fontFamilies.display[700]]: Unbounded_700Bold,
  [fontFamilies.display[800]]: Unbounded_800ExtraBold,
  [fontFamilies.body[400]]: DMSans_400Regular,
  [fontFamilies.body[500]]: DMSans_500Medium,
  [fontFamilies.body[700]]: DMSans_700Bold,
};

/** Charge les six polices ; `[chargées, erreur]`. En cas d'erreur, l'appli continue avec la police du système. */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts(fontAssets);
}
