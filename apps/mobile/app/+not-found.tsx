/** Page introuvable (lien cassé, ancienne adresse) : retour à l'accueil. */
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/Button';
import { Header } from '@/ui/Header';
import { Screen } from '@/ui/Screen';
import { EmptyState } from '@/ui/states';

export default function NotFoundScreen() {
  const { t } = useTranslation('screens');
  return (
    <Screen header={<Header title={t('notFound.title')} />}>
      <EmptyState icon="map" title={t('notFound.title')} message={t('notFound.lead')} />
      <Button label={t('notFound.home')} variant="secondary" onPress={() => router.replace('/')} />
    </Screen>
  );
}
