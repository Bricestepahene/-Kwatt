/** « Jouer » rouvre le dernier espace utilisé (Dames par défaut). */
import { Redirect } from 'expo-router';
import { usePreferences } from '@/preferences';

export default function PlayIndex() {
  const lastSpace = usePreferences((p) => p.lastSpace);
  return <Redirect href={lastSpace === 'ludo' ? '/jouer/ludo' : '/jouer/dames'} />;
}
