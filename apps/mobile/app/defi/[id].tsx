/** Écran 26 · Défi avec mise (planche Mise). */
import { useLocalSearchParams } from 'expo-router';
import { ChallengeScreen } from '@/features/online/screens/ChallengeScreen';

export default function MiseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChallengeScreen id={String(id ?? '')} />;
}
