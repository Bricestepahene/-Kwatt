/** Profil public d'un autre joueur : l'écran 09 en lecture (GET /v1/profiles/:userId). */
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { isApiError } from '@/api/errors';
import { usePlayerProfile } from '@/features/profile/api';
import { ProfileView } from '@/features/profile/ProfileView';
import { LoadError, ProfileSkeleton } from '@/features/profile/states';
import { EmptyState, Header, Screen } from '@/ui';

export default function JoueurScreen() {
  const { t } = useTranslation('profile');
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePlayerProfile(typeof id === 'string' ? id : undefined);
  const hidden = query.isError && isApiError(query.error) && (query.error.status === 404 || query.error.status === 400);

  if (query.data) {
    return (
      <Screen padded={false} gap={0} onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
        <ProfileView profile={query.data} />
      </Screen>
    );
  }
  return (
    <Screen
      padded={query.isError}
      gap={0}
      header={query.isError ? <Header fallback="/profil" /> : undefined}
    >
      {hidden ? (
        <View style={styles.center}>
          <EmptyState icon="lock" title={t('player.notFound')} message={t('player.notFoundBody')} />
        </View>
      ) : query.isError ? (
        <LoadError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <ProfileSkeleton />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
});
