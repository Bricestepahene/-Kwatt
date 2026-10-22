/**
 * Écran 19 · Revoir une partie (planche Revoir) : plateau, coup par coup (avance, recule),
 * notation officielle, analyse asynchrone (@kwatt/engine-dames analyzeGame : qualité de
 * chaque coup, moments clés) et partage. Dames et Ludo (Ludo : la liste des coups).
 */
import { analyzeGame, replay, type GameAnalysis, type KeyMoment } from '@kwatt/engine-dames';
import { parseNotation, type DamesState, type Variant } from '@kwatt/rules-dames';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFormat } from '../../i18n';
import { useTheme } from '../../theme';
import { Button, EmptyState, Icon, IconButton, LoadingState, Screen, SectionLabel, Text, goBack } from '../../ui';
import { DamesBoard } from '../dames/board/DamesBoard';
import { useResult } from './ResultScreen';
import { fullMoves, moveNumberOf, notationLine, progressOf } from './review';
import type { ResultView } from './resultView';

export function ReviewScreen({ id }: { id: string }) {
  const { t } = useTranslation('dames');
  const { view, loading, moves } = useResult(id);
  if (!view) {
    return (
      <Screen space="dames">
        {loading ? (
          <LoadingState />
        ) : (
          <EmptyState icon="search" title={t('result.notFound')} action={{ label: t('game.backToDames'), onPress: () => router.replace('/jouer/dames') }} />
        )}
      </Screen>
    );
  }
  return view.family === 'dames' ? <DamesReview view={view} moves={moves} /> : <LudoReview view={view} moves={moves} />;
}

function Head({ view, count }: { view: ResultView; count: number }) {
  const { t } = useTranslation('dames');
  const { t: tc } = useTranslation('common');
  const name = view.opponent?.machine ? t('result.machineOpponent', { level: t(`difficulty.${view.opponent.machine as 'facile'}`) }) : (view.opponent?.name ?? '');
  return (
    <View style={styles.head}>
      <IconButton icon="back" accessibilityLabel={tc('action.back')} onPress={() => goBack(`/partie/${encodeURIComponent(view.id)}/resultat` as Href)} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1} accessibilityRole="header">
          {t('review.title', { name })}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {t('review.subtitle', { family: t(`result.family.${view.family}`), verdict: t(`review.verdict.${view.verdict}`), count })}
        </Text>
      </View>
    </View>
  );
}

function DamesReview({ view, moves }: { view: ResultView; moves: string[] }) {
  const { t } = useTranslation('dames');
  const f = useFormat();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const variant = (view.variant === 'dames8' ? 'dames8' : 'dames10') as Variant;
  const states = useMemo<DamesState[]>(() => {
    try {
      return replay(variant, moves);
    } catch {
      return replay(variant, []);
    }
  }, [variant, moves]);
  const total = states.length - 1;
  // Position : nombre de demi-coups joués (0 = départ). On ouvre sur la fin de la partie.
  const [pos, setPos] = useState(total);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);

  useEffect(() => {
    setPos(total);
  }, [total]);

  useEffect(() => {
    if (total === 0) return;
    const signal = { aborted: false };
    // Analyse en tâche de fond (budget modeste : l'écran reste fluide).
    void analyzeGame(variant, moves.slice(0, total), { maxNodesPerMove: 6_000, depth: 6, signal })
      .then((a) => {
        if (!signal.aborted) setAnalysis(a);
      })
      .catch(() => undefined);
    return () => {
      signal.aborted = true;
    };
  }, [variant, moves, total]);

  const mySide = (view.me?.seat ?? 0) === 0 ? 'w' : 'b';
  const state = states[pos] ?? states[0]!;
  const lastPly = pos - 1;
  const analyzed = analysis?.moves[lastPly];
  const moment = analysis?.keyMoments.find((k) => k.ply === lastPly);
  const momentText = (k: KeyMoment) => t(`review.moment.${k.kind}`, { square: k.params.square ?? '', count: k.params.count ?? '' });
  const caption =
    pos === 0
      ? t('review.start')
      : moment
        ? momentText(moment)
        : analyzed
          ? t(`review.quality.${analyzed.quality}`)
          : '';
  const lastMove = useMemo(() => (pos === 0 ? null : parseNotation(states[pos - 1]!, moves[pos - 1] ?? '')), [pos, states, moves]);

  const moments = (analysis?.keyMoments ?? []).slice(0, 4);
  const boardSize = Math.min(width - 32, 360);
  const share = () => {
    void Share.share({ message: t('review.shareText', { variant: t(`variant.${variant}.short`), moves: moves.join(' ') }) });
  };

  return (
    <Screen space="dames" padded={false} gap={0} testID="screen-revoir">
      <Head view={view} count={fullMoves(total)} />
      <View style={styles.center}>
        <DamesBoard
          state={state}
          lastMove={lastMove}
          size={boardSize}
          interactive={false}
          flipped={mySide === 'b'}
          accessibilityLabel={pos === 0 ? t('review.start') : t('review.positionAlt', { n: moveNumberOf(lastPly) })}
        />
      </View>
      <View style={styles.body}>
        <View style={styles.moveRow}>
          <Text variant="subheading">{pos === 0 ? t('review.start') : t('review.move', { n: moveNumberOf(lastPly) })}</Text>
          <Text variant="small" tone={analyzed?.quality === 'mistake' && analyzed.side === mySide ? 'alert' : 'muted'} style={styles.flexShrink} numberOfLines={2}>
            {pos === 0 ? '' : caption}
          </Text>
        </View>
        <View style={[styles.notation, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="section" tone="muted" style={styles.notationLabel}>
            {t('review.notation')}
          </Text>
          <Text variant="labelStrong" style={styles.mono} numberOfLines={1} adjustsFontSizeToFit>
            {pos === 0 ? '—' : notationLine(moves, lastPly)}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: colors.border }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.fill, { backgroundColor: colors.text, width: `${progressOf(pos, total) * 100}%` }]} />
          {moments.map((k) => (
            <View
              key={`${k.ply}-${k.kind}`}
              style={[
                styles.mark,
                { left: `${progressOf(k.ply + 1, total) * 100}%`, backgroundColor: k.side === mySide && (k.kind === 'mistake' || k.kind === 'piece_left_hanging' || k.kind === 'missed_win') ? colors.alert : colors.gain },
              ]}
            />
          ))}
        </View>
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('review.prev')}
            disabled={pos === 0}
            onPress={() => setPos((p) => Math.max(0, p - 1))}
            onLongPress={() => setPos(0)}
            style={({ pressed }) => [styles.ctl, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pos === 0 ? 0.45 : pressed ? 0.8 : 1 }]}
          >
            <Icon name="back" size={22} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('review.next')}
            disabled={pos >= total}
            onPress={() => setPos((p) => Math.min(total, p + 1))}
            onLongPress={() => setPos(total)}
            style={({ pressed }) => [styles.ctl, styles.ctlWide, { backgroundColor: colors.inverse, opacity: pos >= total ? 0.45 : pressed ? 0.85 : 1 }]}
          >
            <Icon name="chevronRight" size={22} color={colors.onInverse} />
          </Pressable>
        </View>
        <SectionLabel>{t('review.keyMoments')}</SectionLabel>
        {!analysis ? (
          <Text variant="small" tone="muted">
            {total === 0 ? t('review.empty') : t('review.analyzing')}
          </Text>
        ) : moments.length === 0 ? (
          <Text variant="small" tone="muted">
            {t('review.noMoments')}
          </Text>
        ) : (
          <View style={styles.moments}>
            {moments.map((k) => {
              const bad = k.side === mySide && (k.kind === 'mistake' || k.kind === 'piece_left_hanging' || k.kind === 'missed_win');
              return (
                <Pressable
                  key={`${k.ply}-${k.kind}`}
                  accessibilityRole="button"
                  onPress={() => setPos(k.ply + 1)}
                  style={({ pressed }) => [styles.moment, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text variant="smallStrong" tone={bad ? 'alert' : 'gain'}>
                    {t('review.move', { n: k.moveNumber })}
                  </Text>
                  <Text variant="small" numberOfLines={2}>
                    {momentText(k)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Button label={t('review.share')} size="md" icon="share" onPress={share} />
        <Text variant="caption" tone="muted" align="center">
          {f.number(total)} · {t('review.moves')}
        </Text>
      </View>
    </Screen>
  );
}

function LudoReview({ view, moves }: { view: ResultView; moves: string[] }) {
  const { t } = useTranslation('dames');
  const { colors } = useTheme();
  return (
    <Screen space="ludo" padded={false} gap={0} testID="screen-revoir">
      <Head view={view} count={moves.length} />
      <View style={styles.body}>
        <Text variant="small" tone="muted">
          {t('review.ludoNoBoard')}
        </Text>
        {moves.length === 0 ? (
          <Text variant="small">{t('review.empty')}</Text>
        ) : (
          <View style={[styles.ludoList, { backgroundColor: colors.surface }]}>
            {moves.map((m, i) => {
              const [roll, token] = m.split(':');
              return (
                <Text key={i} variant="small" style={styles.mono}>
                  {i + 1}. {token === '-' ? t('review.ludoPass', { roll }) : t('review.ludoMove', { roll, token: Number(String(token).split('.').pop()) + 1 })}
                </Text>
              );
            })}
          </View>
        )}
        <Button
          label={t('review.share')}
          size="md"
          icon="share"
          onPress={() => void Share.share({ message: moves.join(' ') })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1, textAlign: 'right' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  center: { alignItems: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, gap: 12 },
  moveRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  notation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, gap: 10 },
  notationLabel: { fontSize: 11, letterSpacing: 1.1 },
  mono: { fontFamily: 'monospace' },
  track: { height: 8, borderRadius: 4, position: 'relative' },
  fill: { height: '100%', borderRadius: 4 },
  mark: { position: 'absolute', top: -4, width: 4, height: 16, borderRadius: 2, marginLeft: -2 },
  controls: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  ctl: { width: 52, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ctlWide: { width: 120, borderWidth: 0 },
  moments: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  moment: { flexGrow: 1, flexBasis: '45%', minHeight: 52, borderRadius: 12, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  ludoList: { borderRadius: 12, padding: 12, gap: 4 },
});
