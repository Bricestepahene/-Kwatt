/**
 * Écran 19b · Problème du jour (planche ProblemeDuJour) : GET /v1/puzzles/daily, résolution
 * sur le plateau (coup juste → réponse forcée jouée par l'appli), indice, puis
 * POST /v1/puzzles/daily/solve (validé par le serveur : +10 cauris une fois par jour, série,
 * carte rare à 7 jours). Sans réseau : la solution attend le retour du réseau.
 */
import type { DailyPuzzle, PuzzleVariant } from '@kwatt/protocol';
import { legalMoves } from '@kwatt/rules-dames';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { isApiError } from '../../../api/errors';
import { playBoardFeedback } from '../../../sound';
import { useTheme } from '../../../theme';
import { Button, ErrorState, IconButton, LoadingState, OfflineState, Screen, Skeleton, Text, goBack } from '../../../ui';
import { useDailyPuzzle, useSolvePuzzle } from '../api';
import { DamesBoard } from '../board/DamesBoard';
import { EMPTY_SELECTION, tap, targetsOf, threatened, type Selection } from '../board/selection';
import { forcedReply, hintSquare, playerMove, playerToMove, startProgress, type PuzzleProgress } from '../puzzle';
import { enqueuePuzzleSolve } from '../puzzleSender';
import { useDamesVariant } from '../variantPref';

type Feedback =
  | { kind: 'good' }
  | { kind: 'solved'; reward: number; card: string | null }
  | { kind: 'solvedOffline' }
  | { kind: 'wrong'; expected: string | null };

export function PuzzleScreen() {
  const { t } = useTranslation('dames');
  const { t: tc } = useTranslation('common');
  const params = useLocalSearchParams<{ variant?: string }>();
  const [stored] = useDamesVariant();
  const variant: PuzzleVariant = params.variant === 'dames8' || params.variant === 'dames10' ? params.variant : stored;
  const query = useDailyPuzzle(variant);
  const data = query.data;

  const header = (
    <View style={styles.head}>
      <IconButton icon="back" accessibilityLabel={tc('action.back')} onPress={() => goBack('/jouer/dames')} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" accessibilityRole="header" numberOfLines={1}>
          {t('puzzle.title', { variant: t(`variant.${variant}.short`) })}
        </Text>
        {data ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {data.solved
              ? t('puzzle.subtitleSolved', { count: data.streak })
              : t('puzzle.subtitle', { count: data.streak, reward: data.reward })}
          </Text>
        ) : (
          <Skeleton width="70%" height={12} />
        )}
      </View>
    </View>
  );

  return (
    <Screen space="dames" padded={false} gap={0} testID="screen-probleme">
      {header}
      {data ? (
        <PuzzleBoard key={`${data.dayKey}-${data.puzzle.id}`} puzzle={data.puzzle} dayKey={data.dayKey} solvedToday={data.solved} reward={data.reward} />
      ) : query.isError ? (
        isApiError(query.error) && query.error.isTransient ? (
          <OfflineState onRetry={() => void query.refetch()} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : (
        <LoadingState />
      )}
      {data ? (
        <View style={styles.footer}>
          <Text variant="caption" tone="muted" style={styles.flex}>
            {data.solvedShare !== null ? t('puzzle.shareSolved', { share: data.solvedShare }) : t('puzzle.shareUnknown')}
          </Text>
          <Text variant="caption" tone="muted">
            {t('puzzle.tomorrow', { theme: t(`puzzle.themeTomorrow.${data.tomorrowTheme}`) })}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

function PuzzleBoard({ puzzle, dayKey, solvedToday, reward }: { puzzle: DailyPuzzle; dayKey: string; solvedToday: boolean; reward: number }) {
  const { t } = useTranslation('dames');
  const { colors, reduceMotion } = useTheme();
  const { width } = useWindowDimensions();
  const solve = useSolvePuzzle();
  const [progress, setProgress] = useState<PuzzleProgress>(() => startProgress(puzzle));
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hint, setHint] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const legal = useMemo(() => (playerToMove(puzzle, progress) ? legalMoves(progress.state) : []), [puzzle, progress]);

  const submit = useCallback(
    async (played: string[], correct: boolean) => {
      const body = { dayKey, variant: puzzle.variant, moves: played };
      try {
        const res = await solve.mutateAsync(body);
        if (correct) {
          setFeedback(res.correct ? { kind: 'solved', reward: res.reward, card: res.card } : { kind: 'wrong', expected: null });
          if (res.correct) playBoardFeedback('victory');
        }
      } catch (error) {
        if (!correct) return;
        if (isApiError(error) && error.isTransient) {
          await enqueuePuzzleSolve(body);
          setFeedback({ kind: 'solvedOffline' });
        } else {
          setFeedback({ kind: 'wrong', expected: null });
        }
      }
    },
    [dayKey, puzzle.variant, solve],
  );

  const onSquare = (square: number) => {
    if (!playerToMove(puzzle, progress)) return;
    const r = tap(legal, selection, square);
    if (r.kind !== 'play') {
      setSelection(r.selection);
      if (r.kind === 'invalid') playBoardFeedback('invalid');
      return;
    }
    setSelection(EMPTY_SELECTION);
    setHint(null);
    const next = playerMove(puzzle, progress, r.move);
    setProgress(next);
    playBoardFeedback(r.move.captures.length > 0 ? 'capture' : 'move');
    if (next.status === 'wrong') {
      setFeedback({ kind: 'wrong', expected: next.expected });
      void submit(next.played, false);
    } else if (next.status === 'solved') {
      void submit(next.played, true);
    } else {
      setFeedback({ kind: 'good' });
      timer.current = setTimeout(
        () => {
          setProgress((g) => {
            const after = forcedReply(puzzle, g);
            if (after.status === 'solved') void submit(after.played, true);
            return after;
          });
        },
        reduceMotion ? 150 : 600,
      );
    }
  };

  const retry = () => {
    setProgress(startProgress(puzzle));
    setSelection(EMPTY_SELECTION);
    setFeedback(null);
    setHint(null);
  };

  const size = Math.min(width - 32, 400);
  const flipped = puzzle.side === 'b';
  const sideText = t(`puzzle.side.${puzzle.side}`);

  return (
    <View style={styles.body}>
      <View style={[styles.prompt, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text variant="label">
          <Text variant="labelStrong">{sideText}</Text> {t(`puzzle.theme.${puzzle.theme}`)}
        </Text>
      </View>
      <View style={styles.center}>
        <DamesBoard
          state={progress.state}
          selected={selection.from}
          targets={targetsOf(legal, selection)}
          threatened={threatened(legal, selection)}
          lastMove={progress.last}
          hint={hint}
          onSquarePress={onSquare}
          flipped={flipped}
          showNumbers
          size={size}
          interactive={progress.status === 'playing'}
          accessibilityLabel={t('puzzle.boardAlt', { side: sideText })}
          testID="puzzle-board"
        />
      </View>
      {feedback ? <FeedbackCard feedback={feedback} line={progress.line.join(' · ')} reward={reward} /> : null}
      {solvedToday && !feedback ? (
        <Text variant="small" tone="muted">
          {t('puzzle.alreadySolved')}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {progress.status === 'wrong' || progress.status === 'solved' ? (
          <Button label={t('puzzle.retry')} variant="outline" size="sm" style={styles.flex} onPress={retry} />
        ) : (
          <Button
            label={t('puzzle.hint')}
            variant="outline"
            size="sm"
            icon="bulb"
            style={styles.flex}
            onPress={() => setHint(hintSquare(puzzle, progress))}
          />
        )}
      </View>
      {hint !== null ? (
        <Text variant="small" tone="muted" accessibilityLiveRegion="polite">
          {t('puzzle.hintText', { square: hint })}
        </Text>
      ) : null}
      {solve.isPending ? (
        <Text variant="caption" tone="muted">
          {t('puzzle.sending')}
        </Text>
      ) : null}
    </View>
  );
}

function FeedbackCard({ feedback, line, reward }: { feedback: Feedback; line: string; reward: number }) {
  const { t } = useTranslation('dames');
  const { colors } = useTheme();
  const good = feedback.kind !== 'wrong';
  let title = '';
  let text = '';
  if (feedback.kind === 'good') title = t('puzzle.goodContinue');
  else if (feedback.kind === 'solved') {
    title = feedback.reward > 0 ? t('puzzle.solvedTitle', { reward: feedback.reward }) : t('puzzle.solvedNoReward');
    text = [t('puzzle.solvedText', { line }), feedback.card ? t('puzzle.streakCard') : ''].filter(Boolean).join(' ');
  } else if (feedback.kind === 'solvedOffline') {
    title = t('puzzle.solvedTitle', { reward });
    text = t('puzzle.sendLater');
  } else {
    title = t('puzzle.wrongTitle');
    text = t('puzzle.wrongText');
  }
  return (
    <View accessibilityRole="alert" style={[styles.feedback, { backgroundColor: good ? colors.gainSoft : colors.lossSoft }]}>
      <Text variant="small">
        <Text variant="smallStrong">{title}</Text>
        {text ? ` ${text}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  body: { paddingHorizontal: 16, gap: 12, paddingBottom: 12 },
  prompt: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  center: { alignItems: 'center' },
  feedback: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  actions: { flexDirection: 'row', gap: 8 },
  footer: { marginTop: 'auto', flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingBottom: 20, paddingTop: 8 },
});

