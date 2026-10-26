/**
 * 03 · Vérification de l'adresse (planche Inscription, code de la planche Connexion) :
 * code à 6 chiffres reçu par e-mail (10 min, 5 essais), renvoi après 60 s. On peut jouer
 * avant de vérifier (« Plus tard ») ; l'adresse vérifiée sert à miser et à récupérer le compte.
 * Après l'inscription, la suite est le premier lancement (05) ; depuis les Paramètres, `?next=`.
 */
import { OTP_RESEND_SECONDS } from '@kwatt/protocol';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { accountsApi } from '@/features/accounts/api';
import { FormError, ResendRow } from '@/features/accounts/components';
import { useCountdown, useMe } from '@/features/accounts/hooks';
import { formatCountdown, retryAfterSeconds } from '@/features/accounts/logic';
import { nextParam } from '@/features/accounts/nav';
import { rememberMe } from '@/features/accounts/session';
import { translateError } from '@/i18n';
import { useSession } from '@/session';
import { Button, CodeInput, Icon, Screen, showToast, Text } from '@/ui';
import { useTheme } from '@/theme';

export default function VerifierEmailScreen() {
  const { t } = useTranslation('accounts');
  const { colors } = useTheme();
  const next = nextParam(useLocalSearchParams()) ?? '/premier-lancement';
  const me = useMe();
  const verified = useSession((s) => s.data?.user.emailVerified ?? false);
  const email = me.data?.email ?? '';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Le code vient de partir (inscription, ou « Vérifier » dans les Paramètres).
  const [resendUntil, setResendUntil] = useState<number | null>(() => Date.now() + OTP_RESEND_SECONDS * 1000);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const wait = useCountdown(retryUntil);

  const leave = () => router.replace(next as Href);

  async function verify(value = code) {
    if (value.length !== 6 || busy || wait > 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await accountsApi.verifyEmail(value);
      await rememberMe(updated);
      showToast(t('verify.done'), 'success');
      leave();
    } catch (e) {
      const apiError = toApiError(e);
      setCode('');
      const seconds = retryAfterSeconds(apiError);
      if (seconds !== null) setRetryUntil(Date.now() + seconds * 1000);
      else if (apiError.code === 'auth.already_verified') {
        showToast(t('verify.already'), 'info');
        void me.refetch();
        leave();
      } else if (apiError.code === 'auth.code_invalid' && typeof apiError.params.attemptsLeft === 'number') {
        setError(t('verify.attemptsLeft', { count: apiError.params.attemptsLeft }));
      } else setError(translateError(apiError));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    try {
      const res = await accountsApi.resendVerification();
      setResendUntil(Date.parse(res.resendAvailableAt));
      setCode('');
      showToast(t('verify.resent'), 'info');
    } catch (e) {
      const apiError = toApiError(e);
      const after = apiError.params.retryAfterSeconds;
      if (apiError.code === 'auth.code_resend_too_soon' && typeof after === 'number') setResendUntil(Date.now() + after * 1000);
      else setError(translateError(apiError));
    } finally {
      setResending(false);
    }
  }

  const header = (
    <View style={styles.top}>
      <Button variant="ghost" size="sm" label={t('verify.later')} onPress={leave} />
    </View>
  );

  if (verified) {
    return (
      <Screen header={header} gap={20}>
        <View style={[styles.done, { backgroundColor: colors.gainSoft }]}>
          <Icon name="check" size={28} color={colors.gain} />
        </View>
        <Text variant="display" accessibilityRole="header">
          {t('verify.already')}
        </Text>
        <Button label={t('tutorial.next')} onPress={leave} />
      </Screen>
    );
  }

  return (
    <Screen header={header} gap={20}>
      <View style={styles.titles}>
        <Text variant="display" accessibilityRole="header">
          {t('verify.title')}
        </Text>
        <Text variant="body" tone="muted">
          {email ? t('verify.lead', { email }) : t('verify.why')}
        </Text>
      </View>
      <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} autoFocus />
      <FormError message={wait > 0 ? t('signin.waitRetry', { time: formatCountdown(wait) }) : error} />
      <Button label={t('verify.submit')} loading={busy} disabled={code.length !== 6 || wait > 0} onPress={() => void verify()} />
      <ResendRow
        until={resendUntil}
        question={t('verify.noCode')}
        label={t('verify.resend')}
        labelIn={(time) => t('verify.resendIn', { time })}
        busy={resending}
        onPress={() => void resend()}
      />
      {email ? (
        <Text variant="small" tone="muted">
          {t('verify.why')}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'flex-end', minHeight: 48, alignItems: 'center' },
  titles: { gap: 8 },
  done: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
