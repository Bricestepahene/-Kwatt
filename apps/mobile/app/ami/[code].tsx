/** Lien d'invitation d'ami (`kwatt://ami/CODE`). */
import { useLocalSearchParams } from 'expo-router';
import { FriendLinkScreen } from '@/features/community/screens/FriendLinkScreen';

export default function AmiScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <FriendLinkScreen code={code} />;
}
