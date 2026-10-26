/** Écran 25 · Salon et file d'attente (planche Salon) ; lien kwatt://salon/CODE. */
import { useLocalSearchParams } from 'expo-router';
import { RoomScreen } from '@/features/online/screens/RoomScreen';

export default function SalonScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <RoomScreen code={String(code ?? '')} />;
}
