/**
 * Écran 42 · Raisonnement (planche Raisonnement, bêta) : en-tête « La tête aussi, ça se
 * muscle. », un aperçu jouable (suites logiques et calcul mental, chronométré), puis
 * « Me prévenir à l'ouverture » (liste d'attente côté serveur). Rien n'est classé ni misé.
 */
import { brand } from '@kwatt/design';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { Button, Fabric, IconButton, Screen, Text, goBack, showToast } from '@/ui';
import { useWaitlist } from '../api';
import { REASONING_PREVIEW, REASONING_SECONDS, formatSeconds } from '../logic';

function Preview() {
  const { t } = useTranslation('community');
  const { colors } = useTheme();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [left, setLeft] = useState(REASONING_SECONDS);
  const q = REASONING_PREVIEW[index % REASONING_PREVIEW.length]!;
  const over = left <= 0 && picked === null;
  const answered = picked !== null || over;
  const last = index === REASONING_PREVIEW.length - 1;

  useEffect(() => {
    if (answered) return;
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [answered, index]);

  const next = () => {
    setIndex(last ? 0 : index + 1);
    setPicked(null);
    setLeft(REASONING_SECONDS);
  };
  const right = picked === q.answer;

  return (
    <View style={styles.preview}>
      <View style={styles.previewTop}>
        <Text variant="small" tone="muted">
          {t('reasoning.preview', { n: index + 1, total: REASONING_PREVIEW.length })}
        </Text>
        <Text variant="number" tone={left <= 10 ? 'alert' : 'action'} accessibilityLabel={`${t('reasoning.timer')} ${formatSeconds(left)}`}>
          {formatSeconds(left)}
        </Text>
      </View>
      <View style={[styles.question, { backgroundColor: colors.surface }]}>
        <Text variant="small" tone="muted">
          {q.id === 'mental' ? t('reasoning.questionMental') : t('reasoning.question')}
        </Text>
        <Text variant="display" adjustsFontSizeToFit numberOfLines={1}>
          {q.prompt}
        </Text>
      </View>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {q.options.map((o) => {
          const isAnswer = answered && o === q.answer;
          const wrong = picked === o && o !== q.answer;
          return (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityState={{ checked: picked === o, disabled: answered }}
              disabled={answered}
              onPress={() => setPicked(o)}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: isAnswer ? colors.gainBg : colors.surface,
                  borderColor: isAnswer ? colors.gain : wrong ? colors.alert : colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text variant="numberLarge">{o}</Text>
            </Pressable>
          );
        })}
      </View>
      {answered ? (
        <View style={[styles.feedback, { backgroundColor: colors.surfaceStrong }]} accessibilityLiveRegion="polite">
          <Text variant="bodyStrong" style={{ color: over ? colors.alert : right ? colors.gain : colors.alert }}>
            {over ? t('reasoning.timeUp') : right ? t('reasoning.right') : t('reasoning.wrong')}
          </Text>
          <Text variant="small">{t(`reasoning.explain.${q.id}` as 'reasoning.explain.pronic')}</Text>
          <Button label={last ? t('reasoning.again') : t('reasoning.next')} variant="outline" size="sm" onPress={next} />
        </View>
      ) : null}
    </View>
  );
}

export function ReasoningScreen() {
  const { t } = useTranslation('community');
  const { t: tc } = useTranslation('common');
  const { colors } = useTheme();
  const { query, toggle } = useWaitlist();
  const joined = query.data?.joined ?? false;
  const count = query.data?.count ?? 0;

  return (
    <Screen
      testID="screen-raisonnement"
      padded={false}
      footer={
        <View style={styles.footer}>
          <Button
            label={joined ? t('reasoning.notified') : t('reasoning.notify')}
            variant={joined ? 'outline' : 'primary'}
            size="lg"
            icon={joined ? 'check' : 'bell'}
            loading={toggle.isPending}
            accessibilityHint={joined ? t('reasoning.unnotify') : undefined}
            onPress={() => toggle.mutate(!joined, { onSuccess: (w) => w.joined && showToast(t('reasoning.notifyToast'), 'success') })}
          />
          <Text variant="caption" tone="muted" align="center">
            {count > 0 ? `${t('reasoning.waiting', { count })} · ` : ''}
            {t('reasoning.footer')}
          </Text>
        </View>
      }
    >
      <Fabric name="ndop" style={styles.head}>
        <View style={styles.headRow}>
          <IconButton icon="back" tone="bg" accessibilityLabel={tc('action.back')} onPress={() => goBack('/')} />
          <Text variant="section" style={{ color: brand.raphia }}>
            {t('reasoning.space')}
          </Text>
        </View>
        <Text variant="display" accessibilityRole="header" style={{ color: brand.raphia }}>
          {t('reasoning.title')}
        </Text>
        <View style={styles.tags}>
          {(['sequences', 'mental', 'timed'] as const).map((k) => (
            <View key={k} style={[styles.tag, { backgroundColor: colors.overlay }]}>
              <Text variant="small" style={{ color: brand.raphia }}>
                {t(`reasoning.tags.${k}`)}
              </Text>
            </View>
          ))}
        </View>
      </Fabric>
      <View style={styles.body}>
        <Preview />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18, gap: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  body: { paddingHorizontal: 20, paddingTop: 16 },
  preview: { gap: 12 },
  previewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  question: { borderRadius: 16, padding: 16, gap: 6 },
  options: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  option: { width: '48%', height: 60, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  feedback: { borderRadius: 14, padding: 14, gap: 8, alignItems: 'flex-start' },
  footer: { paddingHorizontal: 20, gap: 8 },
});
