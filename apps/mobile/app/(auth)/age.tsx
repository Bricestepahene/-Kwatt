/**
 * 04 · Contrôle de l'âge (planche Âge), étape 2 sur 2 : année de naissance (− / +), droits
 * de chaque compte, puis envoi de l'inscription (POST /v1/auth/register). Moins de 13 ans :
 * pas de profil, jeu en invité avec un code. L'année n'est jamais affichée ailleurs.
 */
import { brand } from '@kwatt/design';
import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { accountsApi } from '@/features/accounts/api';
import { FormError, RuleRow, StepBars, TopBar } from '@/features/accounts/components';
import {
  ageBandFor,
  ageFor,
  ageRules,
  clampBirthYear,
  DEFAULT_PICKED_AGE,
  formatCountdown,
  OLDEST_PICKABLE_YEAR,
  retryAfterSeconds,
} from '@/features/accounts/logic';
import { withNext } from '@/features/accounts/nav';
import { completeSignIn } from '@/features/accounts/session';
import { FRAME_SETTING_KEY } from '@/features/accounts/settingsSync';
import { isDraftComplete, resetSignupDraft, signupDraftStore, updateSignupDraft, useSignupDraft } from '@/features/accounts/signupDraft';
import { useCountdown } from '@/features/accounts/hooks';
import { translateError, useDynamicT } from '@/i18n';
import { fontFamilies, useTheme } from '@/theme';
import { Button, Screen, showToast, Text } from '@/ui';

/** Bouton − / + de 56 px ; maintenu appuyé, il répète (plus rapide pour remonter les années). */
function StepButton({ label, accessibilityLabel, onStep, disabled }: { label: string; accessibilityLabel: string; onStep: () => void; disabled: boolean }) {
  const { colors } = useTheme();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const step = useRef(onStep);
  step.current = onStep;
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const repeat = (delay: number) => {
    timer.current = setTimeout(() => {
      step.current();
      repeat(Math.max(60, delay * 0.8));
    }, delay);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onStep}
      onLongPress={() => repeat(120)}
      delayLongPress={350}
      onPressOut={stop}
      style={({ pressed }) => [
        styles.stepButton,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={[styles.stepLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export default function AgeScreen() {
  const { t } = useTranslation('accounts');
  const td = useDynamicT();
  const { colors } = useTheme();
  const currentYear = new Date().getFullYear();
  const draft = useSignupDraft((d) => d);
  const [year, setYear] = useState(() => clampBirthYear(draft.birthYear ?? currentYear - DEFAULT_PICKED_AGE, currentYear));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const wait = useCountdown(retryUntil);
  const age = ageFor(year, currentYear);
  const band = ageBandFor(age);
  const ok = band !== 'child';

  const change = (delta: number) => setYear((y) => clampBirthYear(y + delta, currentYear));

  async function finish() {
    if (busy || wait > 0) return;
    const d = signupDraftStore.getState();
    updateSignupDraft({ birthYear: year });
    if (!isDraftComplete(d)) {
      router.replace(withNext('/inscription', d.next));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await accountsApi.register({
        pseudo: d.pseudo,
        email: d.email,
        password: d.password,
        birthYear: year,
        acceptTerms: d.acceptTerms,
      });
      const frame = d.frame;
      const after = String(withNext('/verifier-email', d.next));
      resetSignupDraft();
      await completeSignIn(response, after);
      showToast(response.welcomeBonus > 0 ? t('signup.created', { amount: response.welcomeBonus }) : t('signup.createdNoBonus'), 'success', 4000);
      // Cadre choisi à l'écran 03, gardé dans les réglages du profil (studio d'avatar : équipe Profil).
      void accountsApi.patchSettings({ [FRAME_SETTING_KEY]: frame }).catch(() => undefined);
    } catch (e) {
      const apiError = toApiError(e);
      const seconds = retryAfterSeconds(apiError);
      if (seconds !== null) {
        setRetryUntil(Date.now() + seconds * 1000);
      } else if (apiError.code === 'auth.pseudo_taken' || apiError.code === 'auth.pseudo_invalid' || apiError.code === 'auth.pseudo_banned') {
        const suggestions = Array.isArray(apiError.params.suggestions) ? apiError.params.suggestions.filter((s): s is string => typeof s === 'string') : [];
        updateSignupDraft({ serverError: { field: 'pseudo', code: apiError.code, suggestions } });
        router.replace(withNext('/inscription', d.next));
      } else if (apiError.code === 'auth.email_taken') {
        updateSignupDraft({ serverError: { field: 'email', code: apiError.code, suggestions: [] } });
        router.replace(withNext('/inscription', d.next));
      } else {
        setError(translateError(apiError));
      }
    } finally {
      setBusy(false);
    }
  }

  const title = band === 'child' ? t('age.child') : band === 'teen' ? t('age.teen', { age }) : t('age.adult', { age });
  const rules = ageRules(band);

  const footer = (
    <>
      <FormError message={wait > 0 ? t('signin.waitRetry', { time: formatCountdown(wait) }) : error} />
      {ok ? (
        <Button label={t('age.finish')} loading={busy} disabled={wait > 0} onPress={() => void finish()} />
      ) : (
        <Button
          variant="secondary"
          size="lg"
          label={t('age.playAsGuest')}
          onPress={() => {
            resetSignupDraft();
            router.replace('/rejoindre' as Href);
          }}
        />
      )}
      <Text variant="caption" tone="muted" align="center">
        {t('age.warning')}
      </Text>
    </>
  );

  return (
    <Screen header={<TopBar fallback={withNext('/inscription', draft.next)} right={<StepBars step={2} total={2} />} />} footer={footer} gap={16}>
      <View style={styles.titles}>
        <Text variant="display" accessibilityRole="header">
          {t('age.title')}
        </Text>
        <Text variant="label" tone="muted">
          {t('age.lead')}
        </Text>
      </View>

      <View style={styles.picker}>
        <StepButton label="−" accessibilityLabel={t('age.previous')} onStep={() => change(-1)} disabled={year <= OLDEST_PICKABLE_YEAR} />
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('age.yearA11y')}
          accessibilityValue={{ text: String(year) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => change(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
          style={styles.yearBox}
        >
          <Text style={[styles.year, { color: colors.text }]} allowFontScaling={false}>
            {year}
          </Text>
        </View>
        <StepButton label="+" accessibilityLabel={t('age.next')} onStep={() => change(1)} disabled={year >= currentYear} />
      </View>

      <View
        style={[
          styles.box,
          { backgroundColor: colors.surface, borderColor: ok ? colors.border : brand.rougeToghu },
        ]}
        accessibilityLiveRegion="polite"
      >
        <Text variant="subheading">{title}</Text>
        <View>
          {rules.map((rule, i) => (
            <RuleRow
              key={rule.key}
              first={i === 0}
              label={td(`accounts:age.rule.${rule.key}`)}
              value={rule.value === 'yes' ? t('age.yes') : rule.value === 'no' ? t('age.no') : t('age.ancien')}
              tone={rule.value === 'yes' ? 'gain' : rule.value === 'no' ? 'alert' : 'default'}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titles: { gap: 6 },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  stepButton: { width: 56, height: 56, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontFamily: fontFamilies.display[700], fontSize: 22, lineHeight: 28 },
  yearBox: { width: 150, alignItems: 'center' },
  year: { fontFamily: fontFamilies.display[800], fontSize: 44, lineHeight: 52 },
  box: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
});
