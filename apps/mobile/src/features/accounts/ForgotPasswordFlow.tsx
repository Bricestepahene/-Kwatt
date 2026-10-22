/**
 * « Mot de passe oublié » en 3 étapes (planche Connexion, feuille du bas) :
 * 1 · Contact (adresse) → 2 · Code à 6 chiffres (10 min, 5 essais, renvoi après 60 s)
 * → 3 · Nouveau mot de passe. Toutes les sessions sont fermées, cet appareil est connecté.
 * Rien ne dit si un compte existe pour l'adresse (même réponse dans tous les cas).
 */
import { OTP_RESEND_SECONDS, PASSWORD_MIN_LENGTH } from '@kwatt/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiError, toApiError } from '../../api/errors';
import { translateError } from '../../i18n';
import { useTheme } from '../../theme';
import { Button } from '../../ui/Button';
import { CodeInput } from '../../ui/CodeInput';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { showToast } from '../../ui/Toast';
import { accountsApi } from './api';
import { FormError, PasswordMeter, ResendRow } from './components';
import { useCountdown } from './hooks';
import { formatCountdown, looksLikeEmail, maskEmail, retryAfterSeconds } from './logic';
import { completeSignIn } from './session';

type Step = 0 | 1 | 2;

/** Les trois étapes en tête de feuille : faites (vert), en cours (or), à venir. */
function StepPills({ step }: { step: Step }) {
  const { colors } = useTheme();
  const { t } = useTranslation('accounts');
  const names = [t('forgot.step1'), t('forgot.step2'), t('forgot.step3')];
  return (
    <View style={styles.pills}>
      {names.map((name, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <View
            key={name}
            accessible
            accessibilityLabel={t('forgot.stepA11y', { step: i + 1, name: name.replace(/^\d · /, '') })}
            accessibilityState={{ selected: current }}
            style={[styles.pill, { backgroundColor: done ? colors.gainBg : current ? colors.action : colors.bg }]}
          >
            <Text variant="smallStrong" style={{ color: done || current ? colors.onAction : colors.textMuted, fontSize: 12 }} numberOfLines={1}>
              {name}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function ForgotPasswordFlow({ initialEmail = '', onDone }: { initialEmail?: string; onDone: () => void }) {
  const { t } = useTranslation('accounts');
  const [step, setStep] = useState<Step>(0);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendUntil, setResendUntil] = useState<number | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const wait = useCountdown(retryUntil);

  /** Erreur du serveur : attente (429) ou message traduit. */
  function fail(e: unknown, custom?: (code: string) => string | null) {
    const apiError = toApiError(e);
    const seconds = retryAfterSeconds(apiError);
    if (seconds !== null) {
      setRetryUntil(Date.now() + seconds * 1000);
      setError(null);
      return;
    }
    setError(custom?.(apiError.code) ?? translateError(apiError));
  }

  async function sendCode(resend = false) {
    if (!looksLikeEmail(email)) {
      setError(t('signup.emailInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await accountsApi.forgotPassword(email);
      setResendUntil(Date.now() + OTP_RESEND_SECONDS * 1000);
      if (resend) showToast(t('forgot.resent'), 'info');
      setCode('');
      setStep(1);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await accountsApi.verifyResetCode(email, value);
      setResetToken(res.resetToken);
      setStep(2);
    } catch (e) {
      setCode('');
      fail(e, (c) => (c === 'auth.code_invalid' || c === 'auth.code_expired' ? t('forgot.codeInvalid') : null));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!resetToken) return;
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(translateError(new ApiError('auth.password_too_short', 400, { min: PASSWORD_MIN_LENGTH })));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await accountsApi.resetPassword(resetToken, password);
      await completeSignIn(response, null);
      showToast(t('forgot.done'), 'success', 4000);
      onDone();
    } catch (e) {
      const apiError = toApiError(e);
      if (apiError.code === 'auth.reset_token_invalid') {
        setResetToken(null);
        setStep(0);
      }
      fail(apiError);
    } finally {
      setBusy(false);
    }
  }

  const waitMessage = wait > 0 ? t('signin.waitRetry', { time: formatCountdown(wait) }) : null;

  return (
    <View style={styles.flow}>
      <StepPills step={step} />
      {step === 0 ? (
        <>
          <Text variant="title" accessibilityRole="header">
            {t('forgot.contactTitle')}
          </Text>
          <Text variant="label" tone="muted">
            {t('forgot.contactText')}
          </Text>
          <TextField
            label={t('signup.email')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('signup.emailPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            returnKeyType="send"
            onSubmitEditing={() => void sendCode()}
          />
          <FormError message={waitMessage ?? error} />
          <Button label={t('forgot.sendCode')} loading={busy} disabled={wait > 0} onPress={() => void sendCode()} />
        </>
      ) : step === 1 ? (
        <>
          <Text variant="title" accessibilityRole="header">
            {t('forgot.codeTitle')}
          </Text>
          <Text variant="label" tone="muted">
            {t('forgot.codeText', { email: maskEmail(email.trim()) })}
          </Text>
          <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} autoFocus />
          <FormError message={waitMessage ?? error} />
          <Button label={t('forgot.validate')} loading={busy} disabled={code.length !== 6 || wait > 0} onPress={() => void verify()} />
          <ResendRow
            until={resendUntil}
            question={t('forgot.noCode')}
            label={t('forgot.resend')}
            labelIn={(time) => t('forgot.resendIn', { time })}
            onPress={() => void sendCode(true)}
          />
        </>
      ) : (
        <>
          <Text variant="title" accessibilityRole="header">
            {t('forgot.newTitle')}
          </Text>
          <Text variant="label" tone="muted">
            {t('forgot.newText')}
          </Text>
          <View style={styles.password}>
            <TextField
              label={t('forgot.newPassword')}
              value={password}
              onChangeText={setPassword}
              password
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={() => void save()}
            />
            <PasswordMeter password={password} />
          </View>
          <FormError message={waitMessage ?? error} />
          <Button label={t('forgot.save')} loading={busy} disabled={wait > 0} onPress={() => void save()} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flow: { gap: 16 },
  pills: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, minHeight: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  password: { gap: 6 },
});
