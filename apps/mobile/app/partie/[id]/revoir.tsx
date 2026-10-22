/** Écran 19 · Revoir une partie (planche Revoir), Dames et Ludo. */
import { useLocalSearchParams } from 'expo-router';
import { ReviewScreen } from '@/features/game/ReviewScreen';

export default function RevoirScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReviewScreen id={id ?? ''} />;
}
