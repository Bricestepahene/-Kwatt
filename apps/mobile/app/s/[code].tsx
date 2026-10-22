/** Lien de partage https://<domaine>/s/CODE (et kwatt://s/CODE) : on ouvre le salon. */
import { Redirect, useLocalSearchParams } from 'expo-router';
import { normalizeCodeSegment } from '@/navigation/deepLinks';

export default function ShareLinkRedirect() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const normalized = normalizeCodeSegment(typeof code === 'string' ? code : '');
  return <Redirect href={normalized ? `/salon/${encodeURIComponent(normalized)}` : '/rejoindre'} />;
}
