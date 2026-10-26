/**
 * Formulaire de connexion (écran 06, planche Connexion) : pseudo ou e-mail, mot de passe,
 * « Mot de passe oublié ? ». Erreurs traduites ; trop d'essais → attente affichée.
 * `inert` : affiché sous la feuille « mot de passe oublié », sans interaction.
 */
import { router, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { toApiError } from '../../api/errors';
import { translateError } from '../../i18n';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { showToast } from '../../ui/Toast';
import { accountsApi } from './api';
import { FormError, TopBar } from './components';
import { useCountdown } from './hooks';
import { formatCountdown, looksLikeEmail, retryAfterSeconds } from './logic';
import { withNext } from './nav';
import { completeSignIn } from './session';

export function SignInForm({ next, inert = false }: { next: string | null; inert?: boolean }) {
  const { t } = useTranslation('accounts');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);
  const wait = useCountdown(retryUntil);

  async function submit() {
    if (busy || wait > 0) return;
    if (!login.trim() || !password) {
      setError(t('signin.missing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await accountsApi.login(login, password);
      if (response.deletionCancelled) showToast(t('signin.deletionCancelled'), 'success', 4000);
      // La garde de session quitte l'écran d'entrée vers `next` (ou l'accueil).
      await completeSignIn(response, next ?? '/');
    } catch (e) {
      const apiError = toApiError(e);
      const seconds = retryAfterSeconds(apiError);
      if (seconds !== null) setRetryUntil(Date.now() + seconds * 1000);
      else setError(translateError(apiError));
    } finally {
      setBusy(false);
    }
  }

  const forgotPath = withNext(
    looksLikeEmail(login) ? `/mot-de-passe-oublie?email=${encodeURIComponent(login.trim())}` : '/mot-de-passe-oublie',
    next,
  );

  return (
    <View style={styles.form} pointerEvents={inert ? 'none' : 'auto'} importantForAccessibility={inert ? 'no-hide-descendants' : 'auto'}>
      <TopBar fallback="/bienvenue" />
      <Text variant="display" accessibilityRole="header">
        {t('signin.title')}
      </Text>
      <TextField
        label={t('signin.login')}
        value={login}
        onChangeText={setLogin}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        label={t('signin.password')}
        value={password}
        onChangeText={setPassword}
        password
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        footer={<Button variant="ghost" size="sm" label={t('signin.forgot')} onPress={() => router.push(forgotPath as Href)} />}
      />
      <FormError message={wait > 0 ? t('signin.waitRetry', { time: formatCountdown(wait) }) : error} />
      <Button label={t('signin.submit')} loading={busy} disabled={wait > 0} onPress={() => void submit()} />
      <View style={styles.signup}>
        <Text variant="label" tone="muted">
          {t('signin.noProfile')}
        </Text>
        <Button variant="ghost" size="sm" label={t('signin.create')} onPress={() => router.replace(withNext('/inscription', next))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  signup: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
});
