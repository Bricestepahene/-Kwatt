/**
 * Écran 34b · Choisir la planche du match (planche ChoixPlanche) : la règle de la ligue (qui
 * choisit), la planche de l'aller, puis chaque planche permise avec la force de chacun et tes
 * chances, la planche par défaut sans choix à temps, et « Jouer … en … ».
 */
import type { LeagueBoard, LeagueMatchView } from '@kwatt/protocol';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { translateError, useFormat } from '@/i18n';
import { useSession } from '@/session';
import { useTheme } from '@/theme';
import { Button, Screen, Text, showToast } from '@/ui';
import { OnWood } from '../../dames/FabricHeader';
import { useLeagueMatch, useMatchAction } from '../api';
import { ChoiceBox, LeagueBand, Note, QueryBody, useLeagueDates } from '../components';
import { useLeagueId } from './MatchDayScreen';

/** Petit damier (ou plateau) dessiné, pour reconnaître la planche d'un coup d'œil. */
function BoardThumb({ board }: { board: LeagueBoard }) {
  const { colors } = useTheme();
  const cells = board === 'dames8' ? 4 : 5;
  return (
    <View style={[styles.thumb, { borderColor: colors.board.frame }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: cells }, (_, r) => (
        <View key={r} style={styles.thumbRow}>
          {Array.from({ length: cells }, (_, c) => (
            <View key={c} style={[styles.thumbCell, { backgroundColor: (r + c) % 2 ? colors.board.dark : colors.board.light }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

function BoardChoice({ view }: { view: LeagueMatchView }) {
  const { t } = useTranslation('leagues');
  const f = useFormat();
  const dates = useLeagueDates();
  const me = useSession((s) => s.data?.user.id ?? null);
  const act = useMatchAction(view.league.id, view.match.id);
  const opponent = view.players.find((p) => p.player.userId !== me)?.player;
  const canChoose = view.boardChooser === 'me' || view.boardChooser === 'both';
  const sent = view.boardChoices[me ?? ''] ?? null;
  const [picked, setPicked] = useState<LeagueBoard>(sent ?? view.match.board ?? view.boardRules.defaultBoard);
  const legLabel = view.match.stage === 'decider' ? t('choice.decider') : view.match.leg === 2 ? t('choice.second') : view.match.leg === 1 ? t('choice.first') : t('choice.match');
  const rule =
    view.boardRules.policy === 'home' && view.firstLegBoard && view.match.leg === 2
      ? t('choice.ruleHomeSecond', { name: opponent?.pseudo ?? '', board: t(`board.${view.firstLegBoard}`) })
      : t(`choice.rule.${view.boardRules.policy}`);
  const boardShort = (b: LeagueBoard) => t(`boardShort.${b}`);

  return (
    <>
      <LeagueBand
        game={view.league.game}
        kicker={t('choice.kicker', { name: view.league.name, leg: legLabel })}
        title={t('choice.versus', { name: opponent?.pseudo ?? '', when: dates.dayTime(view.match.matchAt) })}
        fallback={`/ligue/${view.league.id}/match/${view.match.id}` as Href}
      >
        <OnWood variant="small">{rule}</OnWood>
      </LeagueBand>
      <View style={styles.body}>
        <View style={styles.head}>
          <Text variant="section" tone="muted">
            {t(canChoose ? 'choice.yours' : 'choice.boards')}
          </Text>
          {canChoose ? (
            <Text variant="caption" tone="muted">
              {t('choice.before', { when: dates.dayTime(view.boardDeadline) })}
            </Text>
          ) : null}
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('choice.groupLabel')} style={styles.options}>
          {view.boardOdds.map((o) => {
            const mine = o.ratings[me ?? ''];
            const theirs = opponent ? o.ratings[opponent.userId] : undefined;
            const chance = o.myWinChance === null ? null : Math.round(o.myWinChance * 100);
            const edge =
              chance === null
                ? null
                : chance >= 50
                  ? t('choice.edgeMe', { percent: chance })
                  : t('choice.edgeThem', { name: opponent?.pseudo ?? '', percent: chance });
            return (
              <ChoiceBox
                key={o.board}
                radio={false}
                role="radio"
                selected={picked === o.board}
                onPress={() => canChoose && setPicked(o.board)}
                title={t(`board.${o.board}`)}
                sub={[
                  mine !== undefined && theirs !== undefined
                    ? t('choice.ratings', { me: f.number(mine), name: opponent?.pseudo ?? '', them: f.number(theirs) })
                    : null,
                  edge,
                ]
                  .filter(Boolean)
                  .join('\n')}
                style={styles.option}
              >
                <BoardThumb board={o.board} />
              </ChoiceBox>
            );
          })}
        </View>
        <Note>{t('choice.default', { board: boardShort(view.boardRules.defaultBoard), name: opponent?.pseudo ?? '' })}</Note>
        {sent ? (
          <Note tone="gain">{t('choice.sent', { board: boardShort(sent), first: boardShort(view.firstLegBoard ?? view.boardRules.defaultBoard) })}</Note>
        ) : null}
        {canChoose ? (
          <Button
            label={t('choice.submit', { leg: legLabel.toLowerCase(), board: boardShort(picked) })}
            loading={act.isPending}
            disabled={act.isPending || sent === picked}
            onPress={() => act.mutate({ kind: 'board', board: picked }, { onError: (error) => showToast(translateError(error), 'alert') })}
          />
        ) : (
          <Text variant="small" tone="muted">
            {t(`match.chooser.${view.boardChooser}`, { name: opponent?.pseudo ?? '' })}
          </Text>
        )}
      </View>
    </>
  );
}

export function BoardChoiceScreen() {
  const { id, matchId } = useLocalSearchParams<{ id: string; matchId: string }>();
  const leagueId = useLeagueId(id);
  const query = useLeagueMatch(leagueId, matchId);
  return (
    <Screen padded={false} gap={0} testID="screen-choix-planche">
      <QueryBody query={query}>{(view) => <BoardChoice view={view} />}</QueryBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  options: { gap: 10 },
  option: { minHeight: 84 },
  thumb: { width: 48, height: 48, borderRadius: 6, borderWidth: 2, overflow: 'hidden' },
  thumbRow: { flex: 1, flexDirection: 'row' },
  thumbCell: { flex: 1 },
});
