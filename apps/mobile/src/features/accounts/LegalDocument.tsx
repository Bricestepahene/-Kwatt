/**
 * Textes à accepter à l'inscription (écran 03) et à relire depuis les Paramètres (13) :
 * règles du quartier, politique de confidentialité. Contenu : locales/<langue>/legal.json.
 */
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useDynamicT } from '../../i18n';
import { useTheme } from '../../theme';
import { Button } from '../../ui/Button';
import { Header } from '../../ui/Header';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';

export type LegalDoc = 'rules' | 'privacy';

const SECTIONS: Record<LegalDoc, readonly string[]> = {
  rules: ['s1', 's2', 's3', 's4', 's5'],
  privacy: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'],
};

/** Paragraphes séparés par une ligne vide ; une ligne qui commence par « • » est une puce. */
function Body({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.body}>
      {text.split('\n\n').map((paragraph, i) => {
        const lines = paragraph.split('\n');
        if (lines.every((l) => l.startsWith('• '))) {
          return (
            <View key={i} style={styles.list}>
              {lines.map((line, j) => (
                <View key={j} style={styles.bullet}>
                  <View style={[styles.dot, { backgroundColor: colors.textMuted }]} />
                  <Text variant="body" style={styles.flex}>
                    {line.slice(2)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} variant="body">
            {paragraph}
          </Text>
        );
      })}
    </View>
  );
}

export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const { t } = useTranslation('legal');
  const td = useDynamicT();
  const other: LegalDoc = doc === 'rules' ? 'privacy' : 'rules';
  const otherPath: Href = other === 'rules' ? '/legal/regles' : '/legal/confidentialite';
  return (
    <Screen header={<Header title={t(`${doc}.title`)} fallback="/bienvenue" />} gap={20}>
      <View style={styles.intro}>
        <Text variant="caption" tone="muted">
          {t('updated')}
        </Text>
        <Text variant="bodyStrong">{t(`${doc}.intro`)}</Text>
      </View>
      {SECTIONS[doc].map((s) => (
        <View key={s} style={styles.section}>
          <Text variant="subheading" accessibilityRole="header">
            {td(`legal:${doc}.${s}.title`)}
          </Text>
          <Body text={td(`legal:${doc}.${s}.body`)} />
        </View>
      ))}
      <Button variant="outline" size="sm" label={t(`${other}.title`)} onPress={() => router.replace(otherPath)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  section: { gap: 8 },
  body: { gap: 10 },
  list: { gap: 6 },
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  flex: { flex: 1 },
});
