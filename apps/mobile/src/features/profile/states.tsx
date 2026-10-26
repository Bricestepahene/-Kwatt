/**
 * États des écrans du profil (planche Matrice) : chargement (en-tête et carte grisés),
 * données locales datées quand le réseau manque, et choix de l'état d'erreur.
 */
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { isApiError } from '../../api/errors';
import { useFormat } from '../../i18n';
import { useTheme } from '../../theme';
import { ErrorState, Fabric, Icon, OfflineState, Skeleton, Text } from '../../ui';

/** Squelette de l'écran 09 pendant le premier chargement. */
export function ProfileSkeleton() {
  const { colors } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Fabric name="ndop" style={styles.header}>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: colors.bg }]} />
          <View style={styles.names}>
            <Skeleton width="60%" height={22} />
            <Skeleton width="45%" height={14} />
          </View>
        </View>
        <View style={styles.tiles}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.tile, { backgroundColor: colors.bg }]} />
          ))}
        </View>
      </Fabric>
      <View style={styles.body}>
        <Skeleton height={52} radius={14} />
        <Skeleton height={190} radius={18} />
        <Skeleton height={56} radius={12} />
        <Skeleton height={56} radius={12} />
      </View>
    </View>
  );
}

/** « Pas de réseau : voici tes données du … » (données locales). */
export function LocalDataNotice({ savedAt }: { savedAt: number }) {
  const { t } = useTranslation('profile');
  const { colors } = useTheme();
  const f = useFormat();
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: colors.surfaceStrong, borderColor: colors.alert }]}>
      <Icon name="wifiOff" size={18} color={colors.alert} />
      <Text variant="smallStrong" style={styles.noticeText}>
        {t('offline.cached', { date: f.date(savedAt, 'dateTime') })}
      </Text>
    </View>
  );
}

/** Erreur de chargement : hors connexion (on réessaie) ou erreur traduite. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = isApiError(error) && error.isTransient;
  return offline ? <OfflineState onRetry={onRetry} /> : <ErrorState error={error} onRetry={onRetry} />;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 76, paddingBottom: 22, gap: 14 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  names: { flex: 1, gap: 8 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, height: 56, borderRadius: 12 },
  body: { paddingHorizontal: 20, paddingTop: 16, gap: 14 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  noticeText: { flex: 1 },
});
