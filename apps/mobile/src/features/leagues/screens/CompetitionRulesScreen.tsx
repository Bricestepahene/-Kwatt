/**
 * Écran 28b · Plateaux & règles de la compétition (planche ReglesCompetition) : jeu, qui
 * choisit la planche (imposée, qui reçoit, une par journée, commun accord), planches
 * permises, points par table au Ludo, format des rencontres et résumé affiché aux inscrits.
 * Règle le brouillon de la ligue en cours de création (28 ou 31).
 */
import type { LeagueGame } from '@kwatt/protocol';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Header, Screen, SectionLabel, SegmentedTabs, Text, goBack, showToast } from '@/ui';
import { useTheme } from '@/theme';
import { ChoiceBox, Note } from '../components';
import { setLeagueDraft, useLeagueDraft } from '../draftStore';
import { boardChoices, policiesOf, toggleBoard, withGame, withPolicy, withTeams } from '../logic';

const LUDO_POINTS = [4, 2, 1, 0] as const;

export function CompetitionRulesScreen() {
  const { t } = useTranslation('leagues');
  const { colors } = useTheme();
  const draft = useLeagueDraft();
  const back = draft.access === 'public' ? '/ligue-publique/nouvelle' : '/ligue/nouvelle';
  const single = draft.boardRules.policy === 'imposed';
  const teams = draft.teamSize !== null;
  const pickTeams = () => {
    if (draft.access === 'public') return showToast(t('teams.privateOnly'));
    setLeagueDraft((d) => withTeams(d, true));
  };
  const names = draft.boardRules.allowed.map((b) => t(`board.${b}`)).join(', ');
  const summary = single
    ? t('rules.summaryImposed', { boards: names })
    : t('rules.summaryPolicy', { policy: t(`rules.policyShort.${draft.boardRules.policy}`, { board: '' }).trim(), boards: names });

  return (
    <Screen space={draft.game} testID="screen-regles-competition" header={<Header title={t('rules.title')} fallback={back} />}>
      <SegmentedTabs<LeagueGame>
        accessibilityLabel={t('rules.gameLabel')}
        value={draft.game}
        onChange={(game) => setLeagueDraft((d) => withGame(d, game))}
        options={[
          { value: 'dames', label: t('game.dames') },
          { value: 'ludo', label: t('game.ludo') },
        ]}
      />
      <SectionLabel>{t('rules.who')}</SectionLabel>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('rules.who')} style={styles.stack}>
        {policiesOf(draft.game, teams).map((p) => (
          <ChoiceBox
            key={p}
            radio
            role="radio"
            selected={draft.boardRules.policy === p}
            onPress={() => setLeagueDraft((d) => withPolicy(d, p))}
            title={t(`rules.policy.${p}.label`)}
            sub={t(`rules.policy.${p}.desc`)}
            style={styles.policy}
          />
        ))}
      </View>
      <SectionLabel>{t(single ? 'rules.poolSingle' : 'rules.poolMany')}</SectionLabel>
      <View style={styles.pool}>
        {boardChoices(draft).map((b) => (
          <Chip key={b} label={t(`board.${b}`)} selected={draft.boardRules.allowed.includes(b)} onPress={() => setLeagueDraft((d) => toggleBoard(d, b))} />
        ))}
      </View>
      {draft.game === 'ludo' && !teams ? (
        <>
          <SectionLabel>{t('rules.pointsTitle')}</SectionLabel>
          <View style={styles.points}>
            {LUDO_POINTS.map((p, i) => (
              <View key={i} style={[styles.point, { backgroundColor: colors.surface }]} accessible accessibilityLabel={t('rules.pointA11y', { count: p, place: i + 1 })}>
                <Text variant="numberLarge">{p}</Text>
                <Text variant="caption" tone="muted">
                  {t('place', { count: i + 1, ordinal: true })}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="small" tone="muted">
            {t('rules.ludoTables')}
          </Text>
        </>
      ) : null}
      <SectionLabel>{t('rules.formatTitle')}</SectionLabel>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('rules.formatTitle')} style={styles.formats}>
        <ChoiceBox
          role="radio"
          selected={!teams}
          onPress={() => setLeagueDraft((d) => withTeams(d, false))}
          title={t(`rules.solo.${draft.game}.label`)}
          sub={t(`rules.solo.${draft.game}.desc`)}
          style={styles.format}
        />
        <ChoiceBox
          role="radio"
          selected={teams}
          onPress={pickTeams}
          title={t(`rules.team.${draft.game}.label`)}
          sub={t(`rules.team.${draft.game}.desc`)}
          style={[styles.format, draft.access === 'public' ? styles.disabled : null]}
        />
      </View>
      <Note>{t('rules.summary', { summary })}</Note>
      <Button label={t('rules.submit')} onPress={() => goBack(back)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  policy: { minHeight: 56, paddingVertical: 8 },
  pool: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  points: { flexDirection: 'row', gap: 8 },
  point: { flex: 1, borderRadius: 12, alignItems: 'center', paddingVertical: 10 },
  formats: { flexDirection: 'row', gap: 8 },
  format: { flex: 1, minHeight: 60, paddingVertical: 8 },
  disabled: { opacity: 0.5 },
});
