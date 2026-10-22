/** Écran 18 · Fin de partie (planche Resultat), commun aux Dames et au Ludo. */
import { useLocalSearchParams } from 'expo-router';
import { ResultScreen } from '@/features/game/ResultScreen';

export default function ResultatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ResultScreen id={id ?? ''} />;
}
