/** Écran 37 · Autour du damier (planche KwattTV) : regarder une partie en direct. */
import { useLocalSearchParams } from 'expo-router';
import { WatchScreen } from '@/features/online/screens/WatchScreen';

export default function RegarderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WatchScreen gameId={String(id ?? '')} />;
}
