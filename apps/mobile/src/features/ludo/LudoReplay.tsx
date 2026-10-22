/**
 * Plateau de l'écran 19 (revoir) pour le Ludo : la partie est rejouée depuis sa notation
 * (`replayStates` de @kwatt/rules-ludo) et parcourue entrée par entrée (début, recul, avance,
 * fin). Partie illisible (règles maison inconnues de l'historique) : rien n'est affiché.
 */
import { boardGeometry, replayStates, type LudoState } from '@kwatt/rules-ludo';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { IconButton, Text } from '@/ui';
import { LudoBoard } from './board/LudoBoard';
import { presetOfVariant } from './setup';

export function replayFor(variant: string, players: number, moves: readonly string[]): LudoState[] | null {
  const preset = presetOfVariant(variant);
  if (!preset) return null;
  const options = preset === 'pachisi' ? { preset, players: 4, teams: [[0, 2], [1, 3]] } : { preset, players };
  try {
    return replayStates(options, moves);
  } catch {
    return null;
  }
}

export function LudoReplay({ variant, players, moves }: { variant: string; players: number; moves: readonly string[] }) {
  const { t } = useTranslation('ludo');
  const { width } = useWindowDimensions();
  const states = useMemo(() => replayFor(variant, players, moves), [variant, players, moves]);
  const [ply, setPly] = useState(() => (states ? states.length - 1 : 0));
  if (!states) return null;
  const state = states[Math.min(ply, states.length - 1)]!;
  const last = states.length - 1;
  const size = Math.floor(Math.min(width - 32, 520));
  return (
    <View style={styles.root}>
      <LudoBoard state={state} geometry={boardGeometry(state.config.board)} size={size} accessibilityLabel={t('review.position', { ply, total: last })} />
      <View style={styles.controls}>
        <IconButton icon="back" accessibilityLabel={t('review.first')} onPress={() => setPly(0)} disabled={ply === 0} size={48} />
        <IconButton icon="minus" accessibilityLabel={t('review.previous')} onPress={() => setPly(Math.max(0, ply - 1))} disabled={ply === 0} size={48} />
        <Text variant="number" style={styles.count} accessibilityLiveRegion="polite">
          {`${ply} / ${last}`}
        </Text>
        <IconButton icon="plus" accessibilityLabel={t('review.next')} onPress={() => setPly(Math.min(last, ply + 1))} disabled={ply >= last} size={48} />
        <IconButton icon="chevronRight" accessibilityLabel={t('review.last')} onPress={() => setPly(last)} disabled={ply >= last} size={48} />
      </View>
      {ply > 0 ? (
        <Text variant="small" tone="muted" style={styles.count}>
          {moves[ply - 1]}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 10 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { minWidth: 80, textAlign: 'center' },
});
