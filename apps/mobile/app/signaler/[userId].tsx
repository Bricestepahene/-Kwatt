/** Écran 38 · Signaler un joueur. */
import { useLocalSearchParams } from 'expo-router';
import { ReportScreen } from '@/features/community/screens/ReportScreen';

export default function SignalerScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  return <ReportScreen userId={userId} />;
}
