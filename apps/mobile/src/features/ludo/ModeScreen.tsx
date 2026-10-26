/**
 * Écran 20 · Ludo : choisir un mode (planche ModeLudo). Bandeau kaba avec le choix de
 * l'espace, la force et l'échelon (C1) de la variante courante, « Classique · changer » (→ 20b),
 * puis les modes : contre 1 à 3 machines (feuille de lancement, hors ligne possible, pari en
 * ligne via C3), salon entre proches, regarder une table, ligues, et le résumé des règles.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useDynamicT, useFormat } from '@/i18n';
import { useIsOffline } from '@/offline';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Badge, Fabric, Icon, RankBadge, Screen, Text, type IconName, type RankId } from '@/ui';
import { WoodTabs } from '../dames/FabricHeader';
import { useLudoRatings } from './api';
import { savedLocalLudo } from './local/runtime';
import type { LocalLudoOptions } from './local/controller';
import { MachineSheet } from './MachineSheet';
import { summaryKeys } from './mechanics';
import { isRankedSetup, levelFromRating, variantId } from './setup';
import { useLudoSetup } from './setupStore';

type SpaceTab = 'dames' | 'ludo' | 'raisonnement';

function ModeCard({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      onPress={onPress}
      style={({ pressed }) => [styles.mode, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.icon, { backgroundColor: colors.surfaceStrong }]}>
        <Icon name={icon} size={24} color={colors.text} />
      </View>
      <View style={styles.modeTexts}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" tone="muted">
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

export function ModeScreen() {
  const { t } = useTranslation('ludo');
  const td = useDynamicT();
  const f = useFormat();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ jouer?: string }>();
  const setup = useLudoSetup();
  const member = useSession((s) => s.status === 'member');
  const offline = useIsOffline();
  const ratings = useLudoRatings(member && !offline);
  const [sheet, setSheet] = useState(params.jouer === '1');
  const [saved, setSaved] = useState<LocalLudoOptions | null>(null);

  const refreshSaved = useCallback(() => {
    void savedLocalLudo().then(setSaved);
  }, []);
  useEffect(refreshSaved, [refreshSaved]);
  useEffect(() => {
    if (params.jouer === '1') setSheet(true);
  }, [params.jouer]);

  const ranked = isRankedSetup(setup);
  const variantName = td(`ludo:board.${setup.preset}.name`);
  const name = setup.houseSet ? `${variantName} · ${setup.houseSet.name}` : variantName;
  const rating = ranked ? ratings.data?.items.find((i) => i.variant === variantId(setup.preset)) : undefined;
  const shownRating = rating?.rating ?? 900;
  const level = rating?.level ?? levelFromRating(shownRating);
  const summary = summaryKeys(setup)
    .map((k) => td(`ludo:${k}`))
    .join(', ');

  const onSpace = (space: SpaceTab) => {
    if (space === 'dames') router.replace('/jouer/dames' as Href);
    else if (space === 'raisonnement') router.push('/raisonnement' as Href);
  };

  return (
    <Screen edges={['top']} padded={false} gap={0}>
      <Fabric name="kaba" style={styles.band}>
        <WoodTabs<SpaceTab>
          accessibilityLabel={t('mode.spaceLabel')}
          value="ludo"
          onChange={onSpace}
          options={[
            { value: 'dames', label: t('mode.spaces.dames') },
            { value: 'ludo', label: t('mode.spaces.ludo') },
            { value: 'raisonnement', label: t('mode.spaces.raisonnement') },
          ]}
        />
        <View style={[styles.hero, { backgroundColor: colors.bg }]}>
          <Text variant="section" tone="muted">
            {t('mode.space', { players: td(`ludo:mode.players.${setup.preset}`) })}
          </Text>
          <Text variant="display" style={styles.title} accessibilityRole="header">
            {setup.preset === 'pachisi' ? t('mode.titleCowries') : t('mode.title')}
          </Text>
          <View style={styles.heroRow}>
            {ranked ? (
              <>
                <RankBadge level={level} {...(rating ? { rank: rating.rank as RankId } : {})} />
                <Text variant="caption" tone="muted" numberOfLines={1} style={styles.force}>
                  {t('mode.force', { rating: f.number(shownRating) })}
                </Text>
              </>
            ) : (
              <Badge label={t('mode.friendly')} tone="ndop" />
            )}
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('mode.variantLinkLabel', { name })}
              onPress={() => router.push('/ludo/variantes' as Href)}
              hitSlop={12}
              style={styles.variantLink}
            >
              <Text variant="smallStrong" tone="action" numberOfLines={1}>
                {t('mode.variantLink', { name })}
              </Text>
            </Pressable>
          </View>
        </View>
      </Fabric>

      <View style={styles.list}>
        {saved ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('mode.resume.title')}. ${t('mode.resume.sub', { name: td(`ludo:board.${saved.setup.preset}.name`), count: saved.machines })}`}
            onPress={() => router.push(`/ludo/partie/${encodeURIComponent(saved.id)}` as Href)}
            style={({ pressed }) => [styles.mode, { backgroundColor: colors.surface, borderColor: colors.action, borderWidth: 2, opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={[styles.icon, { backgroundColor: colors.action }]}>
              <Icon name="play" size={24} color={colors.onAction} />
            </View>
            <View style={styles.modeTexts}>
              <Text variant="bodyStrong">{t('mode.resume.title')}</Text>
              <Text variant="small" tone="muted">
                {t('mode.resume.sub', { name: td(`ludo:board.${saved.setup.preset}.name`), count: saved.machines })}
              </Text>
            </View>
            <Text variant="smallStrong" tone="action">
              {t('mode.resume.button')}
            </Text>
          </Pressable>
        ) : null}
        <ModeCard icon="machine" title={t('mode.machine.title')} sub={t('mode.machine.sub')} onPress={() => setSheet(true)} />
        <ModeCard icon="friends" title={t('mode.room.title')} sub={t('mode.room.sub')} onPress={() => router.push('/salon/nouveau?jeu=ludo' as Href)} />
        <ModeCard icon="tv" title={t('mode.watch.title')} sub={t('mode.watch.sub')} onPress={() => router.push('/regarder' as Href)} />
        <ModeCard icon="trophy" title={t('mode.leagues.title')} sub={t('mode.leagues.sub')} onPress={() => router.push('/ligues' as Href)} />
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${t('mode.rules', { summary })} ${t('mode.allRules')}`}
          onPress={() => router.push('/regles/ludo' as Href)}
          style={({ pressed }) => [styles.rules, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text variant="small" tone="muted">
            {t('mode.rules', { summary })}{' '}
            <Text variant="smallStrong">{t('mode.allRules')}</Text>
          </Text>
        </Pressable>
      </View>

      <MachineSheet
        visible={sheet}
        setup={setup}
        onClose={() => {
          setSheet(false);
          if (params.jouer) router.setParams({ jouer: undefined });
          refreshSaved();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  band: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, gap: 14 },
  hero: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  title: { fontSize: 24, lineHeight: 30 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 4 },
  force: { flexShrink: 1 },
  variantLink: { marginLeft: 'auto', minHeight: 32, justifyContent: 'center', flexShrink: 1 },
  list: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 10 },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 16, padding: 14, minHeight: 76 },
  icon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  modeTexts: { flex: 1, gap: 2 },
  rules: { marginTop: 6, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
});
