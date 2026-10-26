/**
 * Écran 36 · Guerre des quartiers (planche Quartiers) : en-tête sur toghu (« Saison 3 · encore
 * 9 jours »), ta place et ton quartier, échelle Quartier · Ville · Pays, classement avec la
 * tendance du jour, règles des points, puis « Jouer pour <quartier> ».
 * Les noms de quartiers et de villes sont des données ; les pays se traduisent (accounts).
 */
import type { QuarterScope, QuarterStanding, QuarterStandings } from '@kwatt/protocol';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { brand, fabrics } from '@kwatt/design';
import { useFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { Button, EmptyState, Fabric, IconButton, Screen, SectionLabel, SegmentedTabs, Text, goBack } from '@/ui';
import { accountKeys, accountsApi } from '../../accounts/api';
import { QuarterSheet } from '../../accounts/SettingsSheets';
import { QueryBody } from '../../leagues/components';
import { useStandings } from '../api';

function useNames() {
  const { t, i18n } = useTranslation('community');
  const { t: ta } = useTranslation('accounts');
  const en = i18n.language === 'en';
  const country = (iso: string) => ta(`countries.${iso}` as 'countries.CM', { defaultValue: iso });
  const city = (s: { city: string | null; cityEn: string | null }) => (en && s.cityEn ? s.cityEn : s.city);
  return (s: QuarterStanding, scope: QuarterScope): string => {
    if (scope === 'country') return country(s.country);
    if (scope === 'city') return city(s) ?? country(s.country);
    if (s.name) return s.name;
    const c = city(s);
    return c ? t('quarters.wholeCity', { city: c }) : t('quarters.diaspora', { country: country(s.country) });
  };
}

function Row({ s, scope, mine }: { s: QuarterStanding; scope: QuarterScope; mine: boolean }) {
  const { t } = useTranslation('community');
  const f = useFormat();
  const { colors } = useTheme();
  const name = useNames()(s, scope);
  const trend = s.trend === null ? null : s.trend > 0 ? t('quarters.up', { count: s.trend }) : s.trend < 0 ? t('quarters.down', { count: -s.trend }) : t('quarters.same');
  const trendA11y = s.trend === null ? '' : s.trend > 0 ? t('quarters.trendUp', { count: s.trend }) : s.trend < 0 ? t('quarters.trendDown', { count: -s.trend }) : t('quarters.trendSame');
  return (
    <View
      accessible
      accessibilityLabel={`${s.position}. ${name}. ${t('quarters.players', { count: s.players })}. ${t('quarters.pointsA11y', { points: f.number(s.points) })}. ${trendA11y}`}
      style={[styles.row, { backgroundColor: mine ? colors.surfaceStrong : colors.surface, borderColor: mine ? colors.action : colors.border }]}
    >
      <Text variant="number" tone={mine ? 'action' : 'muted'} style={styles.pos}>
        {s.position}
      </Text>
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="small" tone="muted">
          {t('quarters.players', { count: s.players })}
        </Text>
      </View>
      <View style={styles.pts}>
        <Text variant="number">{f.number(s.points)}</Text>
        {trend ? (
          <Text variant="caption" style={{ color: s.trend && s.trend > 0 ? colors.gain : s.trend && s.trend < 0 ? colors.alert : colors.textMuted }}>
            {trend}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Head({ data }: { data: QuarterStandings | undefined }) {
  const { t } = useTranslation('community');
  const { t: tc } = useTranslation('common');
  const { t: tl } = useTranslation('leagues');
  const { colors } = useTheme();
  const names = useNames();
  const mine = data?.mine ?? null;
  const area = data?.area ?? null;
  return (
    <Fabric name="toghu" style={styles.head}>
      <View style={styles.headRow}>
        <IconButton icon="back" tone="bg" accessibilityLabel={tc('action.back')} onPress={() => goBack('/')} />
        <View style={[styles.flex, styles.veil, { backgroundColor: fabrics.toghu.base }]}>
          {data ? (
            <Text variant="section" style={{ color: brand.orToghu }} numberOfLines={1}>
              {t('quarters.season', { number: data.seasonNumber, count: data.daysLeft })}
            </Text>
          ) : null}
          <Text variant="heading" accessibilityRole="header" style={{ color: brand.raphia }} numberOfLines={1}>
            {t('quarters.title')}
          </Text>
        </View>
      </View>
      {mine && data ? (
        <View style={[styles.mine, { backgroundColor: fabrics.toghu.base }]}>
          <Text variant="numberLarge" style={{ color: brand.orToghu }}>
            {tl('place', { count: mine.position, ordinal: true })}
          </Text>
          <View style={styles.flex}>
            <Text variant="bodyStrong" style={{ color: brand.raphia }} numberOfLines={1}>
              {names(mine, data.scope)}
            </Text>
            <Text variant="small" style={{ color: brand.raphia, opacity: 0.8 }}>
              {data.scope === 'quarter' && area?.city
                ? t('quarters.mineMeta', { city: area.city, players: mine.players, points: data.myPoints })
                : t('quarters.mineMetaCountry', { players: mine.players, points: data.myPoints })}
            </Text>
          </View>
        </View>
      ) : null}
    </Fabric>
  );
}

export function QuartersScreen() {
  const { t, i18n } = useTranslation('community');
  const { t: ta } = useTranslation('accounts');
  const [scope, setScope] = useState<QuarterScope>('quarter');
  const [picking, setPicking] = useState(false);
  const standings = useStandings(scope);
  const myQuarter = useQuery({ queryKey: accountKeys.myQuarter, queryFn: () => accountsApi.myQuarter() });
  const data = standings.data;
  const en = i18n.language === 'en';
  const area = data?.area ?? null;
  const areaCity = area ? (en && area.cityEn ? area.cityEn : area.city) : null;
  const listTitle =
    scope === 'quarter'
      ? areaCity
        ? t('quarters.titleQuarter', { city: areaCity })
        : t('quarters.titleQuarterAll')
      : scope === 'city'
        ? t('quarters.titleCity', { country: area ? ta(`countries.${area.country}` as 'countries.CM', { defaultValue: area.country }) : '' })
        : t('quarters.titleCountry');
  const quarterName = myQuarter.data?.quarter?.name ?? null;

  return (
    <Screen
      testID="screen-quartiers"
      padded={false}
      refreshing={standings.isRefetching}
      onRefresh={() => void standings.refetch()}
      footer={
        <View style={styles.footer}>
          {quarterName ? (
            <Button label={t('quarters.playFor', { name: quarterName })} size="lg" onPress={() => router.push('/jouer' as Href)} />
          ) : (
            <Button label={t('quarters.choose')} size="lg" onPress={() => setPicking(true)} />
          )}
        </View>
      }
    >
      <Head data={data} />
      <View style={styles.body}>
        <SegmentedTabs<QuarterScope>
          accessibilityLabel={t('quarters.scale')}
          value={scope}
          onChange={setScope}
          options={[
            { value: 'quarter', label: t('quarters.tabQuarter') },
            { value: 'city', label: t('quarters.tabCity') },
            { value: 'country', label: t('quarters.tabCountry') },
          ]}
        />
        {myQuarter.data && !myQuarter.data.quarter ? <EmptyState icon="map" title={t('quarters.noQuarterTitle')} message={t('quarters.noQuarterText')} /> : null}
        <QueryBody query={standings}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState icon="trophy" title={t('quarters.emptyTitle')} message={t('quarters.emptyMessage')} />
            ) : (
              <View style={styles.list}>
                <SectionLabel>{listTitle}</SectionLabel>
                {d.items.map((s) => (
                  <Row key={s.key} s={s} scope={d.scope} mine={d.mine?.key === s.key} />
                ))}
                {d.mine && !d.items.some((s) => s.key === d.mine?.key) ? <Row s={d.mine} scope={d.scope} mine /> : null}
              </View>
            )
          }
        </QueryBody>
        <RulesNote />
        {data?.lastChampion ? (
          <Text variant="small" tone="muted" align="center">
            {t('quarters.lastChampion', { name: data.lastChampion.name ?? data.lastChampion.city })}
          </Text>
        ) : null}
      </View>
      <QuarterSheet
        visible={picking}
        mine={myQuarter.data}
        onClose={() => {
          setPicking(false);
          void standings.refetch();
        }}
      />
    </Screen>
  );
}

function RulesNote() {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: colors.surfaceStrong }]}>
      <Text variant="small">{t('quarters.rules')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  head: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, gap: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  veil: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 14, padding: 14 },
  body: { paddingHorizontal: 20, paddingTop: 16, gap: 14 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, minHeight: 60 },
  pos: { width: 30, textAlign: 'center' },
  pts: { alignItems: 'flex-end' },
  note: { borderRadius: 14, padding: 14 },
  footer: { paddingHorizontal: 20 },
});
