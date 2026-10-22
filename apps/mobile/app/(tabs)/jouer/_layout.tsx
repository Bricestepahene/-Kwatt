/**
 * Onglet « Jouer » : les espaces Dames (14) et Ludo (20). L'espace affiché est gardé
 * dans les préférences (`lastSpace`) pour que « Jouer » le rouvre (audit, point 5).
 */
import { Stack, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { updatePreferences, usePreferences, type PlaySpace } from '@/preferences';
import { useTheme } from '@/theme';

export default function PlayLayout() {
  const { colors } = useTheme();
  const segments = useSegments();
  const last = segments[segments.length - 1];
  const lastSpace = usePreferences((p) => p.lastSpace);

  useEffect(() => {
    const space: PlaySpace | null = last === 'dames' || last === 'ludo' ? last : null;
    if (space && space !== lastSpace) updatePreferences({ lastSpace: space });
  }, [last, lastSpace]);

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'none' }} />;
}
