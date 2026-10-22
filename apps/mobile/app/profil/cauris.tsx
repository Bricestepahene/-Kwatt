/**
 * Journal des cauris, depuis le profil (« Mouvement » de la planche Système : qui, combien,
 * pourquoi, partie liée), sur GET /v1/wallet/journal. Motifs traduits, regroupés par jour.
 */
import type { JournalEntry } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useJournal, useMyProfile } from '@/features/profile/api';
import { amountTone, groupByDay, journalDetail, journalKindKey } from '@/features/profile/journal';
import { LoadError } from '@/features/profile/states';
import { useDynamicT, useFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { Button, Card, CauriIcon, EmptyState, Header, Icon, Screen, SectionLabel, Skeleton, Text } from '@/ui';

function JournalRow({ entry }: { entry: JournalEntry }) {
  const { t } = useTranslation('profile');
  const td = useDynamicT();
  const { colors } = useTheme();
  const f = useFormat();
  const kind = td(`profile:journal.kind.${journalKindKey(entry.kind)}`);
  const detail = journalDetail(entry);
  let detailText: string | null = null;
  if (detail?.kind === 'item') {
    const name = td(`items:name.${detail.code}`, { defaultValue: td('items:unknown') });
    detailText = detail.serial ? t('journal.detail.itemSerial', { name, serial: f.number(detail.serial) }) : name;
  } else if (detail?.kind === 'opponent') detailText = t('journal.detail.opponent', { name: detail.name });
  else if (detail?.kind === 'opponents') detailText = t('journal.detail.opponents', { names: detail.names.join(', ') });
  else if (detail?.kind === 'league') detailText = detail.name;
  else if (detail?.kind === 'quest') detailText = t('journal.detail.quest');
  const time = f.date(new Date(entry.createdAt), 'time');
  const tone = amountTone(entry.amount);
  const linked = entry.gameId;

  const body = (
    <>
      <View style={styles.texts}>
        <Text variant="labelStrong" numberOfLines={1}>
          {kind}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={2}>
          {[detailText, time].filter(Boolean).join(' · ')}
        </Text>
        {linked ? (
          <View style={styles.gameLink}>
            <Text variant="smallStrong" tone="action">
              {t('journal.seeGame')}
            </Text>
            <Icon name="chevronRight" size={14} color={colors.actionText} />
          </View>
        ) : null}
      </View>
      <View style={styles.amounts}>
        <Text variant="subheading" tone={tone} numberOfLines={1}>
          {f.signed(entry.amount)}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {t('journal.balanceAfter', { amount: f.caurisAmount(entry.balanceAfter) })}
        </Text>
      </View>
    </>
  );
  const a11y = t('journal.rowA11y', { kind: [kind, detailText].filter(Boolean).join(', '), amount: f.signed(entry.amount), when: time });
  if (!linked) {
    return (
      <View style={[styles.row, { backgroundColor: colors.surface }]} accessible accessibilityLabel={a11y}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={t('journal.seeGame')}
      onPress={() => router.push(`/partie/${encodeURIComponent(linked)}/revoir` as Href)}
      style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

export default function CaurisScreen() {
  const { t } = useTranslation('profile');
  const f = useFormat();
  const journal = useJournal();
  const profile = useMyProfile();
  const entries = useMemo(() => journal.data?.pages.flatMap((p) => p.items) ?? [], [journal.data]);
  const days = useMemo(() => groupByDay(entries, new Date()), [entries]);
  const balance = profile.data?.cauris ?? entries[0]?.balanceAfter ?? null;

  return (
    <Screen
      header={<Header title={t('journal.title')} fallback="/profil" />}
      onRefresh={() => {
        void journal.refetch();
        void profile.refetch();
      }}
      refreshing={journal.isRefetching}
    >
      <Card tone="strong" padding={16} gap={6}>
        <Text variant="section" tone="muted">
          {t('journal.balance')}
        </Text>
        <View style={styles.balance}>
          <CauriIcon size={22} />
          {balance === null ? (
            <Skeleton width={120} height={30} />
          ) : (
            <Text variant="numberLarge" accessibilityLabel={f.cauris(balance)}>
              {f.cauris(balance)}
            </Text>
          )}
        </View>
        <Text variant="small" tone="muted">
          {t('journal.intro')}
        </Text>
      </Card>

      {journal.isPending ? (
        <View style={styles.list}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} radius={12} />
          ))}
        </View>
      ) : journal.isError && entries.length === 0 ? (
        <LoadError error={journal.error} onRetry={() => void journal.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon="info" title={t('journal.empty')} message={t('journal.emptyBody')} compact />
      ) : (
        <View style={styles.list}>
          {days.map((day) => (
            <View key={day.dayKey} style={styles.day}>
              <SectionLabel>
                {day.label === 'today' ? t('journal.today') : day.label === 'yesterday' ? t('journal.yesterday') : f.date(day.date, 'long')}
              </SectionLabel>
              {day.items.map((entry) => (
                <JournalRow key={entry.txId} entry={entry} />
              ))}
            </View>
          ))}
          {journal.hasNextPage ? (
            <Button
              label={t('journal.more')}
              variant="outline"
              size="sm"
              loading={journal.isFetchingNextPage}
              onPress={() => void journal.fetchNextPage()}
            />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balance: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  list: { gap: 16 },
  day: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 56 },
  texts: { flex: 1, gap: 2 },
  gameLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  amounts: { alignItems: 'flex-end', gap: 2, maxWidth: '45%' },
});
