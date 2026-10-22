/** Écran 09 · Profil unique (planche Profil) : ton profil, onglet Profil. */
import { useMyProfile } from '@/features/profile/api';
import { ProfileView } from '@/features/profile/ProfileView';
import { useLocalSnapshot } from '@/features/profile/snapshot';
import { LoadError, LocalDataNotice, ProfileSkeleton } from '@/features/profile/states';
import { useSession } from '@/session';
import { Screen } from '@/ui';

export default function ProfilScreen() {
  const userId = useSession((s) => s.data?.user.id ?? null);
  const query = useMyProfile();
  const snapshot = useLocalSnapshot(userId ? `profile.${userId}` : null, query.data);
  // Hors connexion : les dernières données connues, datées (planche Matrice).
  const local = !query.data && query.isError && snapshot ? snapshot : null;
  const profile = query.data ?? local?.data;

  return (
    <Screen
      padded={false}
      edges={['top']}
      gap={0}
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      {profile ? (
        <ProfileView profile={profile} notice={local ? <LocalDataNotice savedAt={local.savedAt} /> : null} />
      ) : query.isError ? (
        <LoadError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <ProfileSkeleton />
      )}
    </Screen>
  );
}
