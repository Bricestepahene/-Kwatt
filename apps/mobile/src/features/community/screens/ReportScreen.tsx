/**
 * Écran 38 · Signaler (planche Signaler) : feuille posée sur le profil du joueur.
 * « Que s'est-il passé ? », cinq motifs, la dernière partie jointe d'office, « Bloquer aussi »
 * coché par défaut, puis Annuler · Envoyer. Si un signalement attend déjà la modération, on le
 * dit ; bloquer ou débloquer reste possible sans signaler.
 */
import { REPORT_MESSAGE_MAX, REPORT_REASONS, type ReportReason } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { Button, Header, Icon, Screen, Text, TextField, goBack, showToast } from '@/ui';
import { ChoiceBox, Note, PlayerAvatar, QueryBody } from '../../leagues/components';
import { usePlayerProfile } from '../../profile/api';
import { useBlock, useReport, useReportContext } from '../api';

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={styles.check}
    >
      <View style={[styles.box, { borderColor: checked ? colors.action : colors.border, backgroundColor: checked ? colors.action : 'transparent' }]}>
        {checked ? <Icon name="check" size={18} color={colors.onAction} strokeWidth={3} /> : null}
      </View>
      <Text variant="body" style={styles.flex}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ReportScreen({ userId }: { userId: string | undefined }) {
  const { t } = useTranslation('community');
  const f = useFormat();
  const { colors } = useTheme();
  const profile = usePlayerProfile(userId);
  const context = useReportContext(userId);
  const report = useReport();
  const block = useBlock();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [message, setMessage] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const name = profile.data?.pseudo ?? '';
  const needsMessage = reason === 'other' && message.trim().length < 3;
  const close = () => goBack(userId ? (`/joueur/${userId}` as Href) : '/');

  const send = () => {
    if (!userId || !reason || needsMessage) return;
    report.mutate(
      { userId, reason, block: alsoBlock, ...(message.trim() ? { message: message.trim() } : {}) },
      {
        onSuccess: (r) => {
          showToast(r.blocked ? t('report.sentBlocked', { name }) : t('report.sent'), 'success');
          close();
        },
      },
    );
  };

  return (
    <Screen
      testID="screen-signaler"
      header={<Header title={name ? t('report.title', { name }) : undefined} leading="close" onBack={close} />}
      footer={
        <View style={styles.footer}>
          <Button label={t('report.cancel')} variant="outline" size="lg" onPress={close} style={styles.cancel} />
          <Button label={t('report.send')} size="lg" disabled={!reason || needsMessage || context.data?.pending} loading={report.isPending} onPress={send} style={styles.flex} />
        </View>
      }
    >
      {profile.data ? (
        <View style={styles.who}>
          <PlayerAvatar player={{ userId: profile.data.userId, pseudo: name, avatar: profile.data.look ?? null }} size={64} />
          <Text variant="heading">{name}</Text>
        </View>
      ) : null}
      <QueryBody query={context}>
        {(c) => (
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <Text variant="title" accessibilityRole="header">
              {t('report.question')}
            </Text>
            {c.pending ? <Note tone="alert">{t('report.pending')}</Note> : null}
            <View accessibilityRole="radiogroup" accessibilityLabel={t('report.reasons')} style={styles.reasons}>
              {REPORT_REASONS.map((r) => (
                <ChoiceBox
                  key={r}
                  radio
                  role="radio"
                  selected={reason === r}
                  onPress={() => setReason(r)}
                  title={t(`report.reason.${r}.label`)}
                  sub={t(`report.reason.${r}.desc`)}
                />
              ))}
            </View>
            {reason === 'other' ? (
              <TextField
                label={t('report.message')}
                placeholder={t('report.messagePlaceholder')}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={REPORT_MESSAGE_MAX}
                error={message.length > 0 && needsMessage ? t('report.messageNeeded') : null}
              />
            ) : null}
            <View style={[styles.attached, { backgroundColor: colors.bg }]}>
              <Text variant="small" tone="muted">
                {c.game ? t('report.gameAttached', { date: f.date(Date.parse(c.game.playedAt), 'short') }) : t('report.noGame')}
              </Text>
            </View>
            {c.blocked ? (
              <View style={styles.blockedRow}>
                <Text variant="body" style={styles.flex}>
                  {t('report.blocked', { name })}
                </Text>
                <Button
                  label={t('report.unblock')}
                  size="sm"
                  variant="outline"
                  loading={block.isPending}
                  onPress={() => userId && block.mutate({ userId, block: false }, { onSuccess: () => showToast(t('report.unblocked', { name })) })}
                />
              </View>
            ) : (
              <CheckRow checked={alsoBlock} onChange={setAlsoBlock} label={t('report.block')} />
            )}
            {c.pending && !c.blocked ? (
              <Button
                label={t('report.blockOnly')}
                variant="outline"
                loading={block.isPending}
                onPress={() =>
                  userId &&
                  block.mutate(
                    { userId, block: true },
                    {
                      onSuccess: () => {
                        showToast(t('report.blockedDone', { name }));
                        router.back();
                      },
                    },
                  )
                }
              />
            ) : null}
          </View>
        )}
      </QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  who: { alignItems: 'center', gap: 6, opacity: 0.55 },
  sheet: { borderRadius: 24, padding: 20, gap: 14 },
  reasons: { gap: 8 },
  attached: { borderRadius: 12, padding: 12 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  footer: { flexDirection: 'row', gap: 10 },
  cancel: { minWidth: 110 },
});
