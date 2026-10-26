/**
 * 06 · Mot de passe oublié (planche Connexion) : feuille du bas posée sur le formulaire de
 * connexion (contact → code → nouveau mot de passe). Ouverte aussi depuis les Paramètres
 * par un profil connecté (sans formulaire derrière).
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ForgotPasswordFlow } from '@/features/accounts/ForgotPasswordFlow';
import { nextParam } from '@/features/accounts/nav';
import { SignInForm } from '@/features/accounts/SignInForm';
import { sessionStore } from '@/session';
import { useTheme } from '@/theme';
import { BottomSheet, goBack, Screen } from '@/ui';

export default function MotDePasseOublieScreen() {
  const { t } = useTranslation('accounts');
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ email?: string; next?: string }>();
  const next = nextParam(params);
  // Profil connecté à l'ouverture (venu des Paramètres) : on y revient à la fin.
  const [fromSettings] = useState(() => sessionStore.getState().status === 'member');
  const [visible, setVisible] = useState(true);

  const leave = (to: 'back' | Href) => {
    setVisible(false);
    setTimeout(() => {
      if (to === 'back') goBack(fromSettings ? '/parametres' : '/connexion');
      else router.replace(to);
    }, 200);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {!fromSettings ? (
        <Screen gap={16} offlineBanner={false}>
          <SignInForm next={next} inert />
        </Screen>
      ) : null}
      <BottomSheet visible={visible} onClose={() => leave('back')} accessibilityLabel={t('forgot.a11y')}>
        <ForgotPasswordFlow
          initialEmail={typeof params.email === 'string' ? params.email : ''}
          onDone={() => leave(fromSettings ? 'back' : ((next ?? '/') as Href))}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
