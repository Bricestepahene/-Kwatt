/**
 * Feuilles de l'écran 13 (Paramètres, section Compte) : pseudo (1 fois / 30 jours, avec
 * propositions), adresse à vérifier, mot de passe, quartier (1 fois par saison), animation
 * du dé, déconnexion partout, suppression du compte (J+30, annulable en se reconnectant).
 */
import { PASSWORD_MIN_LENGTH, type Me, type MyQuarterResponse, type Quarter } from '@kwatt/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiError, toApiError } from '../../api/errors';
import { translateError, useFormat } from '../../i18n';
import { updatePreferences, usePreferences, type DiceAnimation } from '../../preferences';
import { useTheme } from '../../theme';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons/Icon';
import { ListGroup, ListItem } from '../../ui/ListItem';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { showToast } from '../../ui/Toast';
import { accountKeys, accountsApi } from './api';
import { FormError, PasswordMeter, PseudoField } from './components';
import { useCountdown, usePseudoAvailability } from './hooks';
import { formatCountdown, maskEmail, quarterLabel, retryAfterSeconds } from './logic';
import { QuarterPicker } from './QuarterPicker';
import { forgetSession, rememberMe } from './session';

export type SettingsSheet = 'pseudo' | 'email' | 'password' | 'quarter' | 'dice' | 'logoutAll' | 'delete' | null;

interface SheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Message d'erreur, ou attente quand le serveur demande de patienter (429). */
function useServerError() {
  const [error, setError] = useState<string | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const wait = useCountdown(retryUntil);
  const { t } = useTranslation('accounts');
  return {
    message: wait > 0 ? t('signin.waitRetry', { time: formatCountdown(wait) }) : error,
    waiting: wait > 0,
    clear: () => setError(null),
    set: setError,
    fail(e: unknown, custom?: (apiError: ApiError) => string | null) {
      const apiError = toApiError(e);
      const seconds = retryAfterSeconds(apiError);
      if (seconds !== null) setRetryUntil(Date.now() + seconds * 1000);
      else setError(custom?.(apiError) ?? translateError(apiError));
    },
  };
}

function SheetTitle({ children }: { children: string }) {
  return (
    <Text variant="title" accessibilityRole="header">
      {children}
    </Text>
  );
}

export function PseudoSheet({ visible, onClose, me }: SheetProps & { me: Me }) {
  const { t } = useTranslation('settings');
  const f = useFormat();
  const [pseudo, setPseudo] = useState(me.pseudo ?? '');
  const [busy, setBusy] = useState(false);
  const errors = useServerError();
  const check = usePseudoAvailability(pseudo, me.pseudo);
  const lockedUntil = me.pseudoChangeAvailableAt ? Date.parse(me.pseudoChangeAvailableAt) : null;
  const locked = lockedUntil !== null && lockedUntil > Date.now();
  useEffect(() => {
    if (visible) {
      setPseudo(me.pseudo ?? '');
      errors.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function save() {
    if (pseudo === me.pseudo) return onClose();
    setBusy(true);
    errors.clear();
    try {
      const updated = await accountsApi.changePseudo(pseudo.trim());
      await rememberMe(updated);
      showToast(t('pseudoSheet.done', { pseudo: updated.pseudo ?? '' }), 'success');
      onClose();
    } catch (e) {
      errors.fail(e, (err) => {
        const next = err.params.nextChangeAt;
        return err.code === 'profile.pseudo_change_too_soon' && typeof next === 'string'
          ? t('pseudoSheet.nextChange', { date: f.date(new Date(next), 'long') })
          : null;
      });
    } finally {
      setBusy(false);
    }
  }

  const blocked = check.state === 'invalid' || check.state === 'banned' || check.state === 'taken';
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('pseudoSheet.title')}>
      <View style={styles.sheet}>
        <SheetTitle>{t('pseudoSheet.title')}</SheetTitle>
        <Text variant="label" tone="muted">
          {locked && lockedUntil ? t('pseudoSheet.nextChange', { date: f.date(lockedUntil, 'long') }) : t('pseudoSheet.text')}
        </Text>
        <PseudoField value={pseudo} onChange={setPseudo} check={check} editable={!locked} autoFocus={!locked} />
        <FormError message={errors.message} />
        <Button
          label={t('pseudoSheet.save')}
          loading={busy}
          disabled={locked || blocked || errors.waiting || pseudo.trim() === ''}
          onPress={() => void save()}
        />
      </View>
    </BottomSheet>
  );
}

export function EmailSheet({ visible, onClose, me }: SheetProps & { me: Me }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const errors = useServerError();

  async function send() {
    setBusy(true);
    errors.clear();
    try {
      await accountsApi.resendVerification();
      onClose();
      router.push('/verifier-email?next=%2Fparametres' as Href);
    } catch (e) {
      const apiError = toApiError(e);
      if (apiError.code === 'auth.already_verified') {
        await queryClient.invalidateQueries({ queryKey: accountKeys.me });
        onClose();
      } else if (apiError.code === 'auth.code_resend_too_soon') {
        // Un code est déjà parti il y a moins d'une minute : on va le saisir.
        onClose();
        router.push('/verifier-email?next=%2Fparametres' as Href);
      } else errors.fail(apiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('emailSheet.title')}>
      <View style={styles.sheet}>
        <SheetTitle>{t('emailSheet.title')}</SheetTitle>
        <Text variant="label" tone="muted">
          {t('emailSheet.text', { email: me.email ?? '' })}
        </Text>
        <FormError message={errors.message} />
        <Button label={t('emailSheet.send')} icon="mail" loading={busy} disabled={errors.waiting} onPress={() => void send()} />
      </View>
    </BottomSheet>
  );
}

export function PasswordSheet({ visible, onClose }: SheetProps) {
  const { t } = useTranslation('settings');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const errors = useServerError();
  useEffect(() => {
    if (visible) {
      setCurrent('');
      setNext('');
      errors.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function save() {
    if (next.length < PASSWORD_MIN_LENGTH) {
      errors.set(translateError(new ApiError('auth.password_too_short', 400, { min: PASSWORD_MIN_LENGTH })));
      return;
    }
    setBusy(true);
    errors.clear();
    try {
      await accountsApi.changePassword(current, next);
      showToast(t('passwordSheet.done'), 'success');
      onClose();
    } catch (e) {
      errors.fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('passwordSheet.title')}>
      <View style={styles.sheet}>
        <SheetTitle>{t('passwordSheet.title')}</SheetTitle>
        <Text variant="label" tone="muted">
          {t('passwordSheet.text')}
        </Text>
        <TextField
          label={t('passwordSheet.current')}
          value={current}
          onChangeText={setCurrent}
          password
          autoComplete="current-password"
          textContentType="password"
          footer={
            <Button
              variant="ghost"
              size="sm"
              label={t('passwordSheet.forgot')}
              onPress={() => {
                onClose();
                router.push('/mot-de-passe-oublie' as Href);
              }}
            />
          }
        />
        <View style={styles.gap6}>
          <TextField label={t('passwordSheet.new')} value={next} onChangeText={setNext} password autoComplete="new-password" textContentType="newPassword" />
          <PasswordMeter password={next} />
        </View>
        <FormError message={errors.message} />
        <Button label={t('passwordSheet.save')} loading={busy} disabled={!current || !next || errors.waiting} onPress={() => void save()} />
      </View>
    </BottomSheet>
  );
}

export function QuarterSheet({ visible, onClose, mine }: SheetProps & { mine: MyQuarterResponse | undefined }) {
  const { t } = useTranslation('settings');
  const { t: ta, i18n } = useTranslation('accounts');
  const f = useFormat();
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<Quarter | null>(mine?.quarter ?? null);
  const [busy, setBusy] = useState(false);
  const errors = useServerError();
  const language = i18n.language === 'en' ? 'en' : 'fr';
  const lockedUntil = mine?.nextChangeAt ? Date.parse(mine.nextChangeAt) : null;
  const locked = lockedUntil !== null && lockedUntil > Date.now();
  useEffect(() => {
    if (visible) {
      setChoice(mine?.quarter ?? null);
      errors.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function save() {
    if (!choice || choice.id === mine?.quarter?.id) return onClose();
    setBusy(true);
    errors.clear();
    try {
      const saved = await accountsApi.setQuarter(choice.id);
      queryClient.setQueryData(accountKeys.myQuarter, saved);
      showToast(ta('quarter.saved', { label: quarterLabel(choice, language) }), 'success');
      onClose();
    } catch (e) {
      errors.fail(e, (err) => {
        const next = err.params.nextChangeAt;
        return err.code === 'quarter.change_too_soon' && typeof next === 'string' ? ta('quarter.nextChange', { date: f.date(new Date(next), 'long') }) : null;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('quarterSheet.title')}>
      <View style={styles.sheet}>
        <SheetTitle>{t('quarterSheet.title')}</SheetTitle>
        <Text variant="label" tone="muted">
          {locked && lockedUntil ? ta('quarter.nextChange', { date: f.date(lockedUntil, 'long') }) : t('quarterSheet.text')}
        </Text>
        {locked ? null : <QuarterPicker value={choice} onChange={setChoice} />}
        <FormError message={errors.message} />
        <Button
          label={t('pseudoSheet.save')}
          loading={busy}
          disabled={locked || !choice || choice.id === mine?.quarter?.id || errors.waiting}
          onPress={() => void save()}
        />
      </View>
    </BottomSheet>
  );
}

export function DiceSheet({ visible, onClose }: SheetProps) {
  const { t } = useTranslation('settings');
  const { colors } = useTheme();
  const value = usePreferences((p) => p.diceAnimation);
  const options: { value: DiceAnimation; label: string }[] = [
    { value: 'normal', label: t('game.diceNormal') },
    { value: 'fast', label: t('game.diceFast') },
    { value: 'none', label: t('game.diceNone') },
  ];
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('diceSheet.title')}>
      <View style={styles.sheet}>
        <SheetTitle>{t('diceSheet.title')}</SheetTitle>
        <ListGroup>
          {options.map((o) => (
            <ListItem
              key={o.value}
              label={o.label}
              accessibilityLabel={o.label}
              right={o.value === value ? <Icon name="check" size={20} color={colors.gain} /> : undefined}
              onPress={() => {
                updatePreferences({ diceAnimation: o.value });
                onClose();
              }}
            />
          ))}
        </ListGroup>
      </View>
    </BottomSheet>
  );
}

export function LogoutAllSheet({ visible, onClose }: SheetProps) {
  const { t } = useTranslation('settings');
  const [busy, setBusy] = useState(false);
  const errors = useServerError();
  async function confirm() {
    setBusy(true);
    errors.clear();
    try {
      await accountsApi.logoutAll();
      onClose();
      await forgetSession();
      showToast(t('logoutAllSheet.done'), 'success');
      router.replace('/bienvenue' as Href);
    } catch (e) {
      errors.fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('logoutAllSheet.title')}>
      <View style={styles.sheet}>
        <SheetTitle>{t('logoutAllSheet.title')}</SheetTitle>
        <Text variant="label" tone="muted">
          {t('logoutAllSheet.text')}
        </Text>
        <FormError message={errors.message} />
        <Button variant="danger" label={t('logoutAllSheet.confirm')} icon="logout" loading={busy} onPress={() => void confirm()} />
      </View>
    </BottomSheet>
  );
}

export function DeleteSheet({ visible, onClose, onExport }: SheetProps & { onExport: () => void }) {
  const { t } = useTranslation('settings');
  const f = useFormat();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const errors = useServerError();
  useEffect(() => {
    if (visible) {
      setPassword('');
      errors.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const scheduled = f.date(Date.now() + 30 * 86_400_000, 'long');

  async function confirm() {
    setBusy(true);
    errors.clear();
    try {
      const res = await accountsApi.deleteAccount(password);
      onClose();
      await forgetSession();
      showToast(t('deleteSheet.done', { date: f.date(new Date(res.deletionScheduledFor), 'long') }), 'info', 6000);
      router.replace('/bienvenue' as Href);
    } catch (e) {
      errors.fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('deleteSheet.title')}>
      <View style={styles.sheet}>
        <SheetTitle>{t('deleteSheet.title')}</SheetTitle>
        <Text variant="label">{t('deleteSheet.text', { date: scheduled })}</Text>
        <Button variant="ghost" size="sm" label={t('deleteSheet.exportFirst')} onPress={onExport} style={styles.start} />
        <TextField label={t('deleteSheet.password')} value={password} onChangeText={setPassword} password autoComplete="current-password" />
        <FormError message={errors.message} />
        <Button variant="danger" label={t('deleteSheet.confirm')} icon="trash" loading={busy} disabled={!password || errors.waiting} onPress={() => void confirm()} />
      </View>
    </BottomSheet>
  );
}

/** Adresse affichée dans la ligne « E-mail » (masquée comme le téléphone de la planche). */
export function emailValue(me: Me): string {
  return me.email ? maskEmail(me.email) : '';
}

const styles = StyleSheet.create({
  sheet: { gap: 14 },
  gap6: { gap: 6 },
  start: { alignSelf: 'flex-start' },
});
