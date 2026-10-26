/** Écran 22 · Le dé était-il honnête ? (planche DeHonnete), vérifié dans l'appli. */
import { useLocalSearchParams } from 'expo-router';
import { DiceProofScreen } from '@/features/online/screens/DiceProofScreen';

export default function DeHonneteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DiceProofScreen gameId={String(id ?? '')} />;
}
