/**
 * Morceaux d'écran partagés par l'entrée dans l'appli (01–06) et les Paramètres (13),
 * fidèles aux planches Inscription, Âge, Connexion : barre du haut, étapes, jauge du mot
 * de passe, cadres d'avatar, case à cocher, champ de pseudo, renvoi du code.
 */
import { brand, type FabricName } from '@kwatt/design';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Button, IconButton } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Fabric, FABRICS } from '../../ui/fabrics';
import { goBack } from '../../ui/Header';
import { Icon } from '../../ui/icons/Icon';
import { Text } from '../../ui/Text';
import { TextField, type TextFieldProps } from '../../ui/TextField';
import type { Href } from 'expo-router';
import { useCountdown, type PseudoCheck } from './hooks';
import { formatCountdown, passwordStrength } from './logic';

/** Barre du haut des planches d'entrée : retour de 44 px sur surface, élément à droite. */
export function TopBar({ onBack, fallback = '/bienvenue', right, label }: { onBack?: () => void; fallback?: Href; right?: ReactNode; label?: string }) {
  const { t } = useTranslation('common');
  return (
    <View style={styles.topBar}>
      <IconButton icon="back" accessibilityLabel={t('action.back')} onPress={onBack ?? (() => goBack(fallback))} />
      {label ? (
        <Text variant="small" tone="muted" style={styles.topLabel}>
          {label}
        </Text>
      ) : (
        <View style={styles.topLabel} />
      )}
      {right}
    </View>
  );
}

/** Étapes de l'inscription (planches Inscription et Âge : deux barres de 28 × 6). */
export function StepBars({ step, total }: { step: number; total: number }) {
  const { colors } = useTheme();
  const { t } = useTranslation('accounts');
  return (
    <View accessible accessibilityLabel={t('steps', { step, total })} style={styles.stepBars}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.stepBar, { backgroundColor: i < step ? colors.action : colors.border }]} />
      ))}
    </View>
  );
}

/** Points du premier lancement (planche Tutoriel) : le point courant s'allonge. */
export function StepDots({ step, total }: { step: number; total: number }) {
  const { colors } = useTheme();
  const { t } = useTranslation('accounts');
  return (
    <View accessible accessibilityLabel={t('steps', { step: step + 1, total })} style={styles.dots}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dot, i === step ? { width: 24, backgroundColor: colors.action } : { backgroundColor: colors.border }]} />
      ))}
    </View>
  );
}

/** Jauge de solidité sous le mot de passe : 3 segments et un conseil (« Moyen · ajoute un symbole… »). */
export function PasswordMeter({ password }: { password: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('accounts');
  const s = passwordStrength(password);
  const tint = s.level === 'strong' ? colors.gain : s.level === 'medium' ? colors.action : colors.alert;
  const text =
    s.level === 'empty' ? t('password.hint.empty') : `${t(`password.level.${s.level}`)} · ${t(`password.hint.${s.hint}`)}`;
  return (
    <View style={styles.meter}>
      <View
        style={styles.meterBars}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={s.level === 'empty' ? undefined : t('password.a11y', { level: t(`password.level.${s.level}`) })}
        accessibilityValue={{ min: 0, max: 3, now: s.segments }}
      >
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.meterBar, { backgroundColor: i < s.segments ? tint : colors.border }]} />
        ))}
      </View>
      <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
        {text}
      </Text>
    </View>
  );
}

/** Choix du cadre d'avatar (planche Inscription : quatre ronds de 56 px en tissu). */
export function FramePicker({ value, onChange }: { value: FabricName; onChange: (frame: FabricName) => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('accounts');
  const { t: tc } = useTranslation('common');
  return (
    <View style={styles.frames} accessibilityRole="radiogroup" accessibilityLabel={t('signup.frame')}>
      {FABRICS.map((name) => {
        const selected = name === value;
        return (
          <Pressable
            key={name}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={t('signup.frameOption', { name: tc(`fabric.${name}`) })}
            onPress={() => onChange(name)}
            hitSlop={4}
            style={({ pressed }) => [
              styles.frame,
              { borderColor: selected ? colors.action : colors.border, borderWidth: selected ? 3 : 2, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Fabric name={name} style={styles.frameFill} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Case à cocher (consentement) : 20 px dans une zone de 48 px, texte à côté. */
export function CheckboxRow({
  checked,
  onChange,
  children,
  accessibilityLabel,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  accessibilityLabel: string;
  error?: string | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.checkWrap}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={error ?? undefined}
        onPress={() => onChange(!checked)}
        style={({ pressed }) => [styles.checkRow, { opacity: pressed ? 0.8 : 1 }]}
      >
        <View
          style={[
            styles.checkBox,
            checked
              ? { backgroundColor: colors.action, borderColor: colors.action }
              : { backgroundColor: colors.surface, borderColor: error ? colors.alert : colors.border },
          ]}
        >
          {checked ? <Icon name="check" size={16} color={colors.onAction} strokeWidth={3} /> : null}
        </View>
        <View style={styles.checkText}>{children}</View>
      </Pressable>
      {error ? (
        <Text variant="small" tone="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Champ de pseudo avec la disponibilité en direct et 3 propositions (planche Inscription, Matrice). */
export function PseudoField({
  value,
  onChange,
  check,
  serverError,
  ...rest
}: Omit<TextFieldProps, 'value' | 'onChange' | 'onChangeText' | 'error' | 'hint' | 'label'> & {
  value: string;
  onChange: (pseudo: string) => void;
  check: PseudoCheck;
  /** Refus reçu à l'envoi (déjà traduit). */
  serverError?: string | null;
  label?: string;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('accounts');
  let message: ReactNode = null;
  let tone: 'muted' | 'gain' | 'alert' = 'muted';
  switch (check.state) {
    case 'available':
      message = t('signup.pseudoAvailable');
      tone = 'gain';
      break;
    case 'checking':
      message = t('signup.pseudoChecking');
      break;
    case 'invalid':
      message = t('signup.pseudoRules');
      tone = check.problem === 'tooShort' && value.length < 3 ? 'muted' : 'alert';
      break;
    case 'banned':
      message = t('signup.pseudoBanned');
      tone = 'alert';
      break;
    case 'taken':
      message = t('signup.pseudoTaken');
      tone = 'alert';
      break;
    case 'offline':
      message = t('signup.pseudoOffline');
      break;
    case 'idle':
      message = t('signup.pseudoRules');
      break;
  }
  if (serverError) {
    message = serverError;
    tone = 'alert';
  }
  const borderTone = tone === 'gain' ? colors.gain : tone === 'alert' ? colors.alert : undefined;
  return (
    <View style={styles.pseudo}>
      <TextField
        label={rest.label ?? t('signup.pseudo')}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\s/g, ''))}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        maxLength={20}
        placeholder={t('signup.pseudoPlaceholder')}
        accent={borderTone ?? null}
        {...rest}
      />
      <Text variant="caption" style={{ color: tone === 'gain' ? colors.gain : tone === 'alert' ? colors.alert : colors.textMuted }} accessibilityLiveRegion="polite">
        {message}
      </Text>
      {check.state === 'taken' && check.suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {check.suggestions.map((s) => (
            <Chip key={s} label={s} onPress={() => onChange(s)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** « Rien reçu ? · Renvoyer (0:48) » : lien actif à la fin du compte à rebours de 60 s. */
export function ResendRow({
  until,
  onPress,
  question,
  label,
  labelIn,
  busy,
}: {
  until: number | null;
  onPress: () => void;
  question: string;
  label: string;
  labelIn: (time: string) => string;
  busy?: boolean;
}) {
  const left = useCountdown(until);
  const waiting = left > 0;
  return (
    <View style={styles.resend}>
      <Text variant="label" tone="muted">
        {question}
      </Text>
      <Button
        variant="ghost"
        size="sm"
        label={waiting ? labelIn(formatCountdown(left)) : label}
        disabled={waiting || busy}
        loading={busy}
        onPress={onPress}
        style={styles.resendButton}
      />
    </View>
  );
}

/** Message d'erreur d'un formulaire (bloc corail, lu par les lecteurs d'écran). */
export function FormError({ message, style }: { message: string | null; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.formError, { borderColor: colors.alert, backgroundColor: colors.surface }, style]}>
      <Icon name="alert" size={18} color={colors.alert} />
      <Text variant="small" style={[styles.formErrorText, { color: colors.alert }]}>
        {message}
      </Text>
    </View>
  );
}

/** Ligne « oui / non » de la planche Âge. */
export function RuleRow({ label, value, tone, first }: { label: string; value: string; tone: 'gain' | 'alert' | 'default'; first: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.rule, first ? null : { borderTopWidth: 1, borderTopColor: colors.border }]}>
      <Text variant="label" style={styles.ruleLabel}>
        {label}
      </Text>
      <Text variant="labelStrong" tone={tone} align="right">
        {value}
      </Text>
    </View>
  );
}

/** Bordure de la boîte des droits (planche Âge) : rouge toghu sous 13 ans. */
export const CHILD_BORDER = brand.rougeToghu;

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  topLabel: { flex: 1 },
  stepBars: { flexDirection: 'row', gap: 6 },
  stepBar: { width: 28, height: 6, borderRadius: 3 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  meter: { gap: 6 },
  meterBars: { flexDirection: 'row', gap: 4 },
  meterBar: { flex: 1, height: 4, borderRadius: 2 },
  frames: { flexDirection: 'row', gap: 12 },
  frame: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden' },
  frameFill: { flex: 1 },
  checkWrap: { gap: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 48, paddingVertical: 4 },
  checkBox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkText: { flex: 1 },
  pseudo: { gap: 6 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  resendButton: { minHeight: 44 },
  formError: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  formErrorText: { flex: 1 },
  rule: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 9 },
  ruleLabel: { flex: 1 },
});
