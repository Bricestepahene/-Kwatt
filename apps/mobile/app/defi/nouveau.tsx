/** Défier un ami ou demander la revanche : /defi/nouveau?userId=…&name=…&game=…&rematchOf=… */
import type { RoomGame } from '@kwatt/protocol';
import { useLocalSearchParams } from 'expo-router';
import { NewChallengeScreen } from '@/features/online/screens/NewChallengeScreen';

export default function NouveauDefiScreen() {
  const p = useLocalSearchParams<{ userId: string; name?: string; game?: string; variant?: string; rematchOf?: string }>();
  const game: RoomGame | undefined = p.game === 'ludo' || p.game === 'dames' ? p.game : undefined;
  return (
    <NewChallengeScreen
      params={{
        userId: String(p.userId ?? ''),
        ...(p.name ? { name: p.name } : {}),
        ...(game ? { game } : {}),
        ...(p.variant ? { variant: p.variant } : {}),
        ...(p.rematchOf ? { rematchOf: p.rematchOf } : {}),
      }}
    />
  );
}
