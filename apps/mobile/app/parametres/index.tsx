/**
 * 13 · Paramètres (planche Parametres) : sons du plateau, affichage et jeu, notifications
 * (préférences de l'appareil, recopiées sur le serveur pour un profil), compte (pseudo,
 * e-mail, mot de passe, langue, quartier, sauvegarde), mes données (export JSON, textes,
 * déconnexion partout), se déconnecter, supprimer le compte.
 */
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { accountKeys, accountsApi } from '@/features/accounts/api';
import { exportMyData } from '@/features/accounts/exportData';
import { useMe, useNow } from '@/features/accounts/hooks';
import { quarterLabel } from '@/features/accounts/logic';
import { signOutHere } from '@/features/accounts/session';
import {
  DeleteSheet,
  DiceSheet,
  EmailSheet,
  emailValue,
  LogoutAllSheet,
  PasswordSheet,
  PseudoSheet,
  QuarterSheet,
  type SettingsSheet,
} from '@/features/accounts/SettingsSheets';
import { accountSync, useAccountSync } from '@/features/accounts/sync';
import { setAppLanguage, translateError, useFormat, type Language } from '@/i18n';
import { useIsOffline } from '@/offline';
import { updatePreferences, usePreferences, type SoundPack } from '@/preferences';
import { playSound, soundFor } from '@/sound';
import { useTheme } from '@/theme';
import {
  Button,
  Header,
  ListGroup,
  ListItem,
  Screen,
  SectionLabel,
  SegmentedTabs,
  showToast,
  Skeleton,
  Slider,
  Text,
  Toggle,
} from '@/ui';

/** Trois tuiles de 64 px (planche : « Balafon / par défaut », « Tam-tam », « Silence »). */
function SoundTiles() {
  const { t } = useTranslation('settings');
  const { colors } = useTheme();
  const pack = usePreferences((p) => p.soundPack);
  const volume = usePreferences((p) => p.volume);
  const options: { value: SoundPack; label: string; sub?: string }[] = [
    { value: 'balafon', label: t('sound.balafon'), sub: t('sound.default') },
    { value: 'tamtam', label: t('sound.tamtam') },
    { value: 'silence', label: t('sound.silence') },
  ];
  return (
    <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel={t('sound.title')}>
      {options.map((o) => {
        const selected = o.value === pack;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={o.sub ? `${o.label}, ${o.sub}` : o.label}
            onPress={() => {
              updatePreferences({ soundPack: o.value });
              const preview = soundFor('move', o.value);
              if (preview) playSound(preview, volume);
            }}
            style={({ pressed }) => [
              styles.tile,
              {
                backgroundColor: colors.surface,
                borderColor: selected ? colors.text : colors.border,
                borderWidth: selected ? 2 : 1,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text variant="smallStrong">{o.label}</Text>
            {o.sub ? (
              <Text variant="caption" tone="muted" style={styles.tileSub}>
                {o.sub}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** « Synchronisé il y a 2 min » (planche), ou l'état de l'envoi. */
function BackupValue() {
  const { t } = useTranslation('settings');
  const f = useFormat();
  const now = useNow(30_000);
  const offline = useIsOffline();
  const { lastSyncAt, pending, status } = useAccountSync((s) => s);
  if (status === 'syncing') return <Text variant="label" tone="muted">{t('account.syncing')}</Text>;
  if (pending && offline) return <Text variant="label" tone="muted">{t('account.syncPending')}</Text>;
  if (status === 'failed' || pending) return <Text variant="label" tone="alert">{t('account.syncFailed')}</Text>;
  if (lastSyncAt === null) return <Text variant="label" tone="muted">{t('account.neverSynced')}</Text>;
  return (
    <Text variant="label" tone="gain">
      {t('account.syncedAgo', { when: f.relative(Math.min(lastSyncAt, now), now) })}
    </Text>
  );
}

export default function ParametresScreen() {
  const { t, i18n } = useTranslation('settings');
  const { colors } = useTheme();
  const prefs = usePreferences((p) => p);
  const me = useMe();
  const mine = useQuery({ queryKey: accountKeys.myQuarter, queryFn: () => accountsApi.myQuarter() });
  const [sheet, setSheet] = useState<SettingsSheet>(null);
  const [exporting, setExporting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const language: Language = i18n.language === 'en' ? 'en' : 'fr';
  const close = () => setSheet(null);

  const displayValue = prefs.theme === 'night' ? t('display.night') : prefs.theme === 'sun' ? t('display.sun') : t('display.auto');
  const diceValue = prefs.diceAnimation === 'normal' ? t('game.diceNormal') : prefs.diceAnimation === 'fast' ? t('game.diceFast') : t('game.diceNone');

  async function doExport() {
    setExporting(true);
    try {
      const how = await exportMyData(t('data.exportDialog'));
      if (how === 'downloaded') showToast(t('data.exported'), 'success');
    } catch (e) {
      showToast(translateError(e), 'alert');
    } finally {
      setExporting(false);
    }
  }

  async function logout() {
    setLeaving(true);
    await signOutHere();
    router.replace('/bienvenue' as Href);
  }

  const account = me.data;
  const quarter = mine.data?.quarter ?? null;

  return (
    <Screen header={<Header title={t('title')} fallback="/profil" />} gap={14}>
      <SectionLabel>{t('sound.title')}</SectionLabel>
      <SoundTiles />
      <ListGroup>
        <ListItem
          label={t('sound.volume')}
          right={
            <Slider
              value={prefs.volume}
              onChange={(volume) => updatePreferences({ volume })}
              accessibilityLabel={t('sound.volume')}
              formatValue={(v) => `${Math.round(v * 100)} %`}
              disabled={prefs.soundPack === 'silence'}
              style={styles.slider}
            />
          }
        />
        <ListItem
          label={t('sound.vibration')}
          right={<Toggle value={prefs.vibration} onChange={(vibration) => updatePreferences({ vibration })} accessibilityLabel={t('sound.vibration')} />}
        />
        <ListItem label={t('display.row')} value={displayValue} chevron onPress={() => router.push('/parametres/affichage' as Href)} />
        <ListItem
          label={t('game.boardNumbers')}
          right={<Toggle value={prefs.boardNumbers} onChange={(boardNumbers) => updatePreferences({ boardNumbers })} accessibilityLabel={t('game.boardNumbers')} />}
        />
        <ListItem
          label={t('game.autoSingleMove')}
          right={
            <Toggle
              value={prefs.autoPlaySingleMove}
              onChange={(autoPlaySingleMove) => updatePreferences({ autoPlaySingleMove })}
              accessibilityLabel={t('game.autoSingleMove')}
            />
          }
        />
        <ListItem label={t('game.dice')} value={diceValue} chevron onPress={() => setSheet('dice')} />
      </ListGroup>

      <SectionLabel>{t('notifications.title')}</SectionLabel>
      <ListGroup>
        <ListItem
          label={t('notifications.yourTurn')}
          right={
            <Toggle
              value={prefs.notifications.yourTurn}
              onChange={(yourTurn) => updatePreferences({ notifications: { yourTurn } })}
              accessibilityLabel={t('notifications.yourTurn')}
            />
          }
        />
        <ListItem
          label={t('notifications.roomInvites')}
          right={
            <Toggle
              value={prefs.notifications.roomInvites}
              onChange={(roomInvites) => updatePreferences({ notifications: { roomInvites } })}
              accessibilityLabel={t('notifications.roomInvites')}
            />
          }
        />
        <ListItem
          label={t('notifications.leagueMatches')}
          right={
            <Toggle
              value={prefs.notifications.leagueMatches}
              onChange={(leagueMatches) => updatePreferences({ notifications: { leagueMatches } })}
              accessibilityLabel={t('notifications.leagueMatches')}
            />
          }
        />
      </ListGroup>

      <SectionLabel>{t('account.title')}</SectionLabel>
      {me.isError && !account ? (
        <Text variant="small" tone="alert">
          {t('loadError')}
        </Text>
      ) : null}
      <ListGroup>
        {account ? (
          <ListItem label={t('account.pseudo')} value={account.pseudo ?? ''} chevron onPress={() => setSheet('pseudo')} />
        ) : (
          <ListItem label={t('account.pseudo')} right={<Skeleton width={90} height={14} />} />
        )}
        {account ? (
          <ListItem
            label={t('account.email')}
            hint={account.emailVerified ? t('account.verified') : t('account.toVerify')}
            value={emailValue(account)}
            right={
              account.emailVerified ? undefined : (
                <Text variant="labelStrong" tone="action">
                  {t('account.verify')}
                </Text>
              )
            }
            onPress={account.emailVerified ? undefined : () => setSheet('email')}
          />
        ) : (
          <ListItem label={t('account.email')} right={<Skeleton width={120} height={14} />} />
        )}
        <ListItem
          label={t('account.password')}
          accessibilityLabel={`${t('account.password')}, ${t('account.change')}`}
          right={
            <Text variant="labelStrong" tone="action">
              {t('account.change')}
            </Text>
          }
          onPress={() => setSheet('password')}
        />
        <ListItem
          label={t('account.language')}
          right={
            <SegmentedTabs<Language>
              accessibilityLabel={t('account.language')}
              value={language}
              onChange={(lang) => void setAppLanguage(lang)}
              options={[
                { value: 'fr', label: 'Français' },
                { value: 'en', label: 'English' },
              ]}
              style={[styles.language, { backgroundColor: colors.bg }]}
            />
          }
        />
        <ListItem
          label={t('account.quarter')}
          value={quarter ? quarterLabel(quarter, language) : t('account.quarterNone')}
          valueTone={quarter ? 'muted' : 'action'}
          chevron
          onPress={() => setSheet('quarter')}
        />
        <ListItem
          label={t('account.backup')}
          right={<BackupValue />}
          onPress={() => void accountSync.flush()}
          accessibilityLabel={t('account.backup')}
        />
      </ListGroup>

      <SectionLabel>{t('data.title')}</SectionLabel>
      <ListGroup>
        <ListItem label={t('data.export')} hint={t('data.exportHint')} icon="share" onPress={() => void doExport()} disabled={exporting} />
        <ListItem label={t('data.rules')} icon="book" chevron onPress={() => router.push('/legal/regles' as Href)} />
        <ListItem label={t('data.privacy')} icon="lock" chevron onPress={() => router.push('/legal/confidentialite' as Href)} />
        <ListItem label={t('data.logoutAll')} hint={t('data.logoutAllHint')} icon="logout" onPress={() => setSheet('logoutAll')} />
      </ListGroup>

      <View style={styles.bottom}>
        <Button variant="outline" size="sm" label={t('logout')} loading={leaving} onPress={() => void logout()} style={styles.half} />
        <Button variant="danger" size="sm" label={t('delete')} onPress={() => setSheet('delete')} style={styles.half} />
      </View>

      {account ? (
        <>
          <PseudoSheet visible={sheet === 'pseudo'} onClose={close} me={account} />
          <EmailSheet visible={sheet === 'email'} onClose={close} me={account} />
        </>
      ) : null}
      <PasswordSheet visible={sheet === 'password'} onClose={close} />
      <QuarterSheet visible={sheet === 'quarter'} onClose={close} mine={mine.data} />
      <DiceSheet visible={sheet === 'dice'} onClose={close} />
      <LogoutAllSheet visible={sheet === 'logoutAll'} onClose={close} />
      <DeleteSheet
        visible={sheet === 'delete'}
        onClose={close}
        onExport={() => {
          close();
          void doExport();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4 },
  tileSub: { fontSize: 11 },
  slider: { width: 140 },
  language: { width: 176 },
  bottom: { flexDirection: 'row', gap: 10, marginTop: 6 },
  half: { flex: 1 },
});
