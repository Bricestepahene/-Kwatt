/**
 * 01 · Bienvenue (planche Bienvenue) : page d'arrivée sans session, et « accueil » des
 * invités. Choix FR · EN visible ici (un invité n'a pas accès aux Paramètres).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setAppLanguage, type Language } from '@/i18n';
import { nextParam, withNext } from '@/features/accounts/nav';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Button, Card, Fabric, Logo, OfflineBanner, SCREEN_MAX_WIDTH, SegmentedTabs, Text, Wordmark } from '@/ui';

export default function BienvenueScreen() {
  const { t, i18n } = useTranslation('accounts');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('preferences');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const next = nextParam(useLocalSearchParams());
  const isGuest = useSession((s) => s.status === 'guest');
  const language: Language = i18n.language === 'en' ? 'en' : 'fr';

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Fabric name="ndop" style={[styles.hero, { paddingTop: insets.top + 56 }]}>
          <View style={[styles.language, { top: insets.top + 12 }]}>
            <SegmentedTabs<Language>
              variant="overlay"
              accessibilityLabel={t('welcome.language')}
              value={language}
              onChange={(lang) => void setAppLanguage(lang)}
              options={[
                { value: 'fr', label: 'FR', accessibilityLabel: tp('language.fr') },
                { value: 'en', label: 'EN', accessibilityLabel: tp('language.en') },
              ]}
            />
          </View>
          <Logo size={120} />
          <Wordmark />
        </Fabric>

        <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, 12) + 22 }]}>
          <OfflineBanner />
          <View style={styles.games} accessible accessibilityLabel={`${t('welcome.dames')}, ${t('welcome.ludo')}, ${t('welcome.soon')}`}>
            <Text variant="small" tone="muted">
              {t('welcome.dames')}
            </Text>
            <Text variant="small" tone="muted" aria-hidden>
              ·
            </Text>
            <Text variant="small" tone="muted">
              {t('welcome.ludo')}
            </Text>
            <Text variant="small" tone="muted" aria-hidden>
              ·
            </Text>
            <Text variant="small" tone="muted">
              {t('welcome.soon')}
            </Text>
          </View>

          <Card radius={18} gap={12} style={styles.joinCard}>
            <Text variant="bodyStrong">{t('welcome.friendCode')}</Text>
            <Button icon="keypad" label={t('welcome.join')} onPress={() => router.push(withNext('/rejoindre', next))} />
            <Text variant="caption" tone="muted" align="center">
              {t('welcome.noAccountNeeded')}
            </Text>
          </Card>

          <Button variant="secondary" label={t('welcome.createProfile')} onPress={() => router.push(withNext('/inscription', next))} />
          <Button
            variant="ghost"
            size="sm"
            label={t('welcome.haveAccount')}
            onPress={() => router.push(withNext('/connexion', next))}
            style={styles.link}
          />
          {isGuest ? (
            <Text variant="small" tone="muted" align="center">
              {t('welcome.guestNote')}
            </Text>
          ) : null}

          <Text variant="caption" tone="muted" align="center" style={styles.noAds}>
            {tc('app.noAds')}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'stretch' },
  hero: {
    minHeight: 430,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingBottom: 32,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  language: { position: 'absolute', right: 20, width: 128 },
  body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, gap: 14, width: '100%', maxWidth: SCREEN_MAX_WIDTH, alignSelf: 'center' },
  games: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  joinCard: { marginTop: 6 },
  link: { alignSelf: 'center', paddingHorizontal: 12 },
  noAds: { marginTop: 'auto', paddingTop: 12 },
});
