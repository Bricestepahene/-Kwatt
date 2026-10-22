/**
 * 05 · Premier lancement (planche Tutoriel) : trois étapes. 1 · un profil, tous les jeux ;
 * 2 · choix du quartier (PUT /v1/me/quarter, changeable une fois par saison, D-11) ;
 * 3 · première partie (Dames contre la machine, ou Ludo). « Passer » mène à l'accueil.
 */
import { brand, type FabricName } from '@kwatt/design';
import type { Quarter } from '@kwatt/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { accountKeys, accountsApi } from '@/features/accounts/api';
import { FormError, StepDots } from '@/features/accounts/components';
import { quarterLabel } from '@/features/accounts/logic';
import { nextParam } from '@/features/accounts/nav';
import { QuarterPicker } from '@/features/accounts/QuarterPicker';
import { translateError } from '@/i18n';
import { fontFamilies, useTheme } from '@/theme';
import { Button, Fabric, OfflineBanner, SCREEN_MAX_WIDTH, showToast, Text } from '@/ui';

const STEPS: readonly { fabric: FabricName; title: 'step1Title' | 'step2Title' | 'step3Title'; text: 'step1Text' | 'step2Text' | 'step3Text' }[] = [
  { fabric: 'ndop', title: 'step1Title', text: 'step1Text' },
  { fabric: 'toghu', title: 'step2Title', text: 'step2Text' },
  { fabric: 'kaba', title: 'step3Title', text: 'step3Text' },
];

/** Grande tuile de jeu en tissu (planche : « Dames » sur obom, « Ludo » sur kaba). */
function GameTile({ fabric, label, accessibilityLabel, onPress, chip }: { fabric: FabricName; label: string; accessibilityLabel: string; onPress: () => void; chip?: boolean }) {
  // Le tissu est le même dans les deux thèmes : texte raphia, pastille nuit sur le kaba (couleurs de marque).
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}>
      <Fabric name={fabric} style={styles.tileFill}>
        <View style={[styles.tileLabel, chip ? { backgroundColor: brand.nuit } : null]}>
          <Text style={[styles.tileText, { color: brand.raphia }]}>{label}</Text>
        </View>
      </Fabric>
    </Pressable>
  );
}

export default function PremierLancementScreen() {
  const { t, i18n } = useTranslation('accounts');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const next = (nextParam(useLocalSearchParams()) ?? '/') as Href;
  const [step, setStep] = useState(0);
  const [quarter, setQuarter] = useState<Quarter | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const language = i18n.language === 'en' ? 'en' : 'fr';

  const mine = useQuery({ queryKey: accountKeys.myQuarter, queryFn: () => accountsApi.myQuarter() });
  useEffect(() => {
    if (mine.data?.quarter && quarter === null) setQuarter(mine.data.quarter);
  }, [mine.data, quarter]);

  const finish = () => router.replace(next);

  async function goNext() {
    setError(null);
    if (step === 1 && quarter && quarter.id !== mine.data?.quarter?.id) {
      setBusy(true);
      try {
        const saved = await accountsApi.setQuarter(quarter.id);
        queryClient.setQueryData(accountKeys.myQuarter, saved);
        showToast(t('quarter.saved', { label: quarterLabel(quarter, language) }), 'success');
      } catch (e) {
        setError(translateError(e));
        return;
      } finally {
        setBusy(false);
      }
    }
    if (step < 2) setStep(step + 1);
    else finish();
  }

  const current = STEPS[step] ?? STEPS[0]!;
  // Pendant la recherche du quartier, le tissu se fait plus petit pour laisser la place à la liste.
  const heroHeight = step === 1 ? 220 : 360;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Fabric name={current.fabric} style={[styles.hero, { height: heroHeight + insets.top, paddingTop: insets.top }]}>
          <View style={[styles.circle, step === 1 ? styles.circleSmall : null, { backgroundColor: colors.bg }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={[styles.number, step === 1 ? styles.numberSmall : null, { color: colors.text }]} allowFontScaling={false}>
              {step + 1}
            </Text>
          </View>
        </Fabric>

        <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}>
          <OfflineBanner />
          <Text variant="display" accessibilityRole="header">
            {t(`tutorial.${current.title}`)}
          </Text>
          <Text variant="body" tone="muted" style={styles.text}>
            {t(`tutorial.${current.text}`)}
          </Text>

          {step === 1 ? <QuarterPicker value={quarter} onChange={setQuarter} /> : null}
          {step === 2 ? (
            <View style={styles.tiles}>
              <GameTile
                fabric="obom"
                label={t('tutorial.playDames')}
                accessibilityLabel={t('tutorial.playA11y', { game: t('tutorial.playDames') })}
                onPress={() => router.replace('/dames/machine' as Href)}
              />
              <GameTile
                fabric="kaba"
                chip
                label={t('tutorial.playLudo')}
                accessibilityLabel={t('tutorial.playA11y', { game: t('tutorial.playLudo') })}
                onPress={() => router.replace('/jouer/ludo' as Href)}
              />
            </View>
          ) : null}
          <FormError message={error} />

          <View style={styles.bottom}>
            <StepDots step={step} total={3} />
            <Button variant="ghost" size="sm" label={t('tutorial.skip')} onPress={finish} style={styles.skip} />
            <Button size="md" label={step < 2 ? t('tutorial.next') : t('tutorial.finish')} loading={busy} onPress={() => void goNext()} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
  hero: { alignItems: 'center', justifyContent: 'center', borderBottomLeftRadius: 36, borderBottomRightRadius: 36 },
  circle: { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center' },
  circleSmall: { width: 110, height: 110, borderRadius: 55 },
  number: { fontFamily: fontFamilies.display[800], fontSize: 86, lineHeight: 100 },
  numberSmall: { fontSize: 60, lineHeight: 72 },
  body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, gap: 14, width: '100%', maxWidth: SCREEN_MAX_WIDTH, alignSelf: 'center' },
  text: { fontSize: 16, lineHeight: 25 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, minHeight: 92, borderRadius: 16, overflow: 'hidden' },
  tileFill: { flex: 1, minHeight: 92, justifyContent: 'flex-end', padding: 10 },
  tileLabel: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  tileText: { fontFamily: fontFamilies.display[800], fontSize: 16, lineHeight: 22 },
  bottom: { marginTop: 'auto', paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  skip: { marginLeft: 'auto' },
});
