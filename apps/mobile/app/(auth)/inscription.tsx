/**
 * 03 · Créer son profil (planche Inscription), étape 1 sur 2 : cadre d'avatar, pseudo
 * (disponibilité en direct, 3 propositions), e-mail, mot de passe (jauge), consentement.
 * L'envoi a lieu à l'étape 2 (année de naissance, écran 04). Un invité qui s'inscrit garde
 * ses parties (compte converti). D-05 : e-mail seulement, sans connexion Google ou Apple.
 */
import { PASSWORD_MIN_LENGTH } from '@kwatt/protocol';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type TextInputInstance } from 'react-native';
import { ApiError } from '@/api/errors';
import { CheckboxRow, FramePicker, PasswordMeter, PseudoField, StepBars, TopBar } from '@/features/accounts/components';
import { usePseudoAvailability } from '@/features/accounts/hooks';
import { looksLikeEmail } from '@/features/accounts/logic';
import { nextParam, withNext } from '@/features/accounts/nav';
import { signupDraftStore, updateSignupDraft } from '@/features/accounts/signupDraft';
import { translateError, useDynamicT } from '@/i18n';
import { Button, Screen, Text, TextField } from '@/ui';

export default function InscriptionScreen() {
  const { t } = useTranslation('accounts');
  const td = useDynamicT();
  const paramNext = nextParam(useLocalSearchParams());
  const [initial] = useState(() => signupDraftStore.getState());
  const next = paramNext ?? initial.next;
  const [pseudo, setPseudo] = useState(initial.pseudo);
  const [email, setEmail] = useState(initial.email);
  const [password, setPassword] = useState(initial.password);
  const [frame, setFrame] = useState(initial.frame);
  const [consent, setConsent] = useState(initial.acceptTerms);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState(initial.serverError);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const check = usePseudoAvailability(pseudo);

  // Erreur du serveur (pseudo pris, adresse déjà utilisée) revenue de l'écran 04 : une seule fois.
  useEffect(() => {
    if (initial.serverError) updateSignupDraft({ serverError: null });
  }, [initial.serverError]);

  const pseudoServerError =
    serverError?.field === 'pseudo' && serverError && pseudo === initial.pseudo ? td(`errors:${serverError.code}`) : null;
  const emailServerError = serverError?.field === 'email' && email === initial.email ? td(`errors:${serverError.code}`) : null;
  const pseudoBlocked = check.state === 'invalid' || check.state === 'banned' || check.state === 'taken' || pseudo.trim() === '';
  const emailError = emailServerError ?? (submitted && !looksLikeEmail(email) ? t('signup.emailInvalid') : null);
  const passwordError =
    submitted && password.length < PASSWORD_MIN_LENGTH
      ? translateError(new ApiError('auth.password_too_short', 400, { min: PASSWORD_MIN_LENGTH }))
      : null;
  const consentError = submitted && !consent ? t('signup.consentRequired') : null;

  function submit() {
    setSubmitted(true);
    if (pseudoBlocked || !looksLikeEmail(email) || password.length < PASSWORD_MIN_LENGTH || !consent) return;
    if (pseudoServerError || emailServerError) return;
    updateSignupDraft({ pseudo: pseudo.trim(), email: email.trim(), password, frame, acceptTerms: consent, next, serverError: null });
    router.push('/age');
  }

  return (
    <Screen header={<TopBar fallback={withNext('/bienvenue', next)} right={<StepBars step={1} total={2} />} />} gap={16}>
      <View style={styles.titles}>
        <Text variant="display" accessibilityRole="header">
          {t('signup.title')}
        </Text>
        <Text variant="label" tone="muted">
          {t('signup.lead')}
        </Text>
      </View>

      <View style={styles.block}>
        <Text variant="smallStrong">{t('signup.frame')}</Text>
        <FramePicker value={frame} onChange={setFrame} />
      </View>

      <PseudoField
        value={pseudo}
        onChange={(value) => {
          setPseudo(value);
          if (serverError?.field === 'pseudo') setServerError(null);
        }}
        check={submitted && pseudo.trim() === '' ? { state: 'invalid', problem: 'empty' } : check}
        serverError={pseudoServerError}
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
      />

      <TextField
        ref={emailRef}
        label={t('signup.email')}
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (serverError?.field === 'email') setServerError(null);
        }}
        placeholder={t('signup.emailPlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        error={emailError}
      />

      <View style={styles.block}>
        <TextField
          ref={passwordRef}
          label={t('signup.password')}
          value={password}
          onChangeText={setPassword}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          error={passwordError}
        />
        <PasswordMeter password={password} />
      </View>

      <CheckboxRow checked={consent} onChange={setConsent} accessibilityLabel={t('signup.consentA11y')} error={consentError}>
        <Text variant="small">
          {t('signup.consentBefore')}
          {t('signup.consentRules')}
          {t('signup.consentMiddle')}
          {t('signup.consentPrivacy')}
          {t('signup.consentAfter')}
        </Text>
      </CheckboxRow>
      <View style={styles.links}>
        <Button variant="ghost" size="sm" label={t('signup.consentRules')} onPress={() => router.push('/legal/regles' as Href)} />
        <Text variant="small" tone="muted" aria-hidden>
          ·
        </Text>
        <Button variant="ghost" size="sm" label={t('signup.consentPrivacy')} onPress={() => router.push('/legal/confidentialite' as Href)} />
      </View>

      <Button label={t('signup.submit')} onPress={submit} />
      <Button variant="ghost" size="sm" label={t('signup.haveAccount')} onPress={() => router.replace(withNext('/connexion', next))} style={styles.center} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titles: { gap: 6 },
  block: { gap: 8 },
  links: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: -8 },
  center: { alignSelf: 'center' },
});
