/**
 * 06 · Connexion (planche Connexion) : pseudo ou e-mail + mot de passe (D-05 : e-mail
 * seulement en V1). « Mot de passe oublié ? » ouvre la feuille de /mot-de-passe-oublie.
 */
import { useLocalSearchParams } from 'expo-router';
import { nextParam } from '@/features/accounts/nav';
import { SignInForm } from '@/features/accounts/SignInForm';
import { Screen } from '@/ui';

export default function ConnexionScreen() {
  const next = nextParam(useLocalSearchParams());
  return (
    <Screen gap={16}>
      <SignInForm next={next} />
    </Screen>
  );
}
