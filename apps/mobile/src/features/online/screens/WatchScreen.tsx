/**
 * Écran 37 · Autour du damier (planche KwattTV) : regarder une partie en direct (sans profil),
 * pronostics du public (50 cauris, 18 ans et plus, fermés au coup 10), réactions rapides
 * montrées aux joueurs à la fin seulement, et « Défier le gagnant · file d'attente ».
 */
import { brand } from '@kwatt/design';
import { GAME_REACTIONS, type GameSeat, type WatchView } from '@kwatt/protocol';
import type { DamesState } from '@kwatt/rules-dames';
import { boardGeometry, type LudoState } from '@kwatt/rules-ludo';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { api } from '@/api/client';
import { translateError, useFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { Button, Fabric, IconButton, Screen, Text, goBack, showToast } from '@/ui';
import { DamesBoard } from '../../dames/board/DamesBoard';
import { OnWood } from '../../dames/FabricHeader';
import type { GameController } from '../../game/controller';
import { resolveControllerReady, unregisterController } from '../../game/registry';
import { QueryBody } from '../../leagues/components';
import { LudoBoard } from '../../ludo/board/LudoBoard';
import { usePredict, useWatch } from '../api';
import { predictionShares } from '../logic';

type AnyController = GameController<DamesState | LudoState, unknown>;

export function WatchScreen({ gameId }: { gameId: string }) {
  const query = useWatch(gameId);
  return (
    <Screen testID="screen-regarder" padded={false} header={null}>
      <QueryBody query={query}>{(w) => <WatchBody watch={w} />}</QueryBody>
    </Screen>
  );
}

/** Suit une partie en spectateur (contrôleur distant « regarder »). */
function useSpectated(family: 'dames' | 'ludo', id: string) {
  const [controller, setController] = useState<AnyController | null>(null);
  const [state, setState] = useState<DamesState | LudoState | null>(null);
  useEffect(() => {
    let alive = true;
    let off: (() => void) | null = null;
    void resolveControllerReady(family, id, { spectate: true }).then((c) => {
      if (!alive || !c) return;
      const ctl = c as AnyController;
      setController(ctl);
      setState(ctl.getState());
      off = ctl.subscribe((s) => setState(s));
    });
    return () => {
      alive = false;
      off?.();
      unregisterController(id);
    };
  }, [family, id]);
  return { controller, state };
}

function WatchBody({ watch }: { watch: WatchView }) {
  const { t } = useTranslation('online');
  const { t: tc } = useTranslation('common');
  const f = useFormat();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const game = watch.game;
  const { controller, state } = useSpectated(game.family, game.id);
  const predict = usePredict(game.id);
  const p = watch.predictions;
  const shares = useMemo(() => predictionShares(p.pools.length ? p.pools : game.seats.map((s) => ({ seat: s.seat, total: 0 }))), [p.pools, game.seats]);
  const live = game.status === 'playing';
  const boardSize = Math.min(width - 24, 520);
  const progress = state
    ? game.family === 'dames'
      ? t('watch.move', { n: Math.floor((state as DamesState).ply / 2) + 1 })
      : t('watch.turn', { n: (state as LudoState).turnNo })
    : '';
  const context = game.league ? t('watch.league') : game.room ? t('watch.room', { code: game.room.code }) : t(`game.${game.family}`);
  const seatName = (s: GameSeat) => s.pseudo;

  const react = (key: string) => {
    controller?.react?.(key);
    showToast(t('watch.reactionSent'));
  };

  const challengeWinner = async () => {
    const code = watch.queue?.code;
    if (!code) return;
    try {
      await api.post(`/v1/rooms/${code}/join`, { as: 'queue' });
      router.push(`/salon/${code}` as Href);
    } catch (e) {
      showToast(translateError(e), 'alert');
    }
  };

  return (
    <>
      <Fabric name={game.family === 'ludo' ? 'kaba' : 'obom'} style={styles.band}>
        <View style={styles.topRow}>
          <IconButton icon="back" tone="bg" accessibilityLabel={t('watch.back')} onPress={() => goBack('/regarder' as Href)} />
          {live ? (
            <View style={[styles.live, { backgroundColor: brand.rougeToghu }]}>
              <View style={[styles.liveDot, { backgroundColor: brand.raphia }]} />
              <OnWood variant="badge">{t('watch.live')}</OnWood>
            </View>
          ) : (
            <OnWood variant="badge">{t('watch.ended')}</OnWood>
          )}
          <OnWood variant="small">{t('watch.viewers', { count: watch.spectators })}</OnWood>
          <OnWood variant="small" style={styles.context} numberOfLines={1}>
            {context}
          </OnWood>
        </View>
        <View style={styles.players}>
          {game.seats.slice(0, game.family === 'dames' ? 2 : 6).map((s, i) => (
            <View key={s.seat} style={[styles.player, i === 1 && game.family === 'dames' ? styles.right : null]}>
              <OnWood variant="bodyStrong" numberOfLines={1}>
                {seatName(s)}
              </OnWood>
            </View>
          ))}
          {game.family === 'dames' && progress ? (
            <OnWood variant="smallStrong" style={styles.progress}>
              {progress}
            </OnWood>
          ) : null}
        </View>
      </Fabric>

      <View style={styles.boardWrap}>
        {state && game.family === 'dames' ? (
          <DamesBoard state={state as DamesState} size={boardSize} interactive={false} accessibilityLabel={t('watch.boardLabel')} />
        ) : state ? (
          <LudoBoard state={state as LudoState} geometry={boardGeometry((state as LudoState).config.board)} size={boardSize} accessibilityLabel={t('watch.boardLabel')} />
        ) : (
          <View style={[styles.boardPlaceholder, { width: boardSize, height: boardSize, backgroundColor: colors.surface }]} />
        )}
        {game.family === 'ludo' && progress ? (
          <Text variant="smallStrong" tone="muted">
            {progress}
          </Text>
        ) : null}
      </View>

      <View style={styles.pad}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.shareRow}>
            <Text variant="caption" tone="muted">
              {t('watch.predictions')}
            </Text>
            <Text variant="caption" tone="muted">
              {p.open ? t('watch.closesAt', { n: p.closesAt }) : t('watch.closed')}
            </Text>
          </View>
          <View style={styles.shareBar} accessible accessibilityLabel={game.seats.map((s) => `${s.pseudo} ${shares.get(s.seat) ?? 0} %`).join(', ')}>
            {game.seats.map((s, i) => (
              <View key={s.seat} style={{ flex: Math.max(1, shares.get(s.seat) ?? 0), backgroundColor: i % 2 === 0 ? colors.action : brand.bleuWouri }} />
            ))}
          </View>
          <View style={styles.shareRow}>
            {game.seats.map((s) => (
              <Text key={s.seat} variant="smallStrong" numberOfLines={1}>
                {s.pseudo} {shares.get(s.seat) ?? 0} %
              </Text>
            ))}
          </View>
          {p.mine ? (
            <Text variant="small" style={{ color: colors.gain }}>
              {p.mine.payout !== null ? t('watch.payout', { amount: f.number(p.mine.payout) }) : t('watch.mine', { name: game.seats.find((s) => s.seat === p.mine!.seat)?.pseudo ?? '' })}
            </Text>
          ) : p.eligible && p.open ? (
            <View style={styles.votes}>
              {game.seats.map((s) => (
                <Button
                  key={s.seat}
                  label={t('watch.bet', { name: s.pseudo, stake: f.number(p.stake) })}
                  variant="outline"
                  size="sm"
                  onPress={() => predict.mutate(s.seat, { onError: (e) => showToast(translateError(e), 'alert') })}
                  style={styles.vote}
                />
              ))}
            </View>
          ) : !p.eligible ? (
            <Text variant="caption" tone="muted">
              {t('watch.notEligible')}
            </Text>
          ) : null}
        </View>

        {live ? (
          <View style={styles.reactions} accessibilityLabel={t('watch.reactions')}>
            {GAME_REACTIONS.slice(0, 4).map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                onPress={() => react(key)}
                style={({ pressed }) => [styles.reaction, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
              >
                <Text variant="smallStrong" numberOfLines={1}>
                  {tc(`reaction.${key}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text variant="caption" tone="muted">
          {t('watch.note')}
        </Text>
        {watch.queue ? (
          <Button
            label={watch.queue.myPosition ? t('watch.inQueue', { position: watch.queue.myPosition }) : t('watch.challengeWinner')}
            onPress={() => (watch.queue?.myPosition ? router.push(`/salon/${watch.queue.code}` as Href) : void challengeWinner())}
          />
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  band: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 14, gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  context: { marginLeft: 'auto', flexShrink: 1 },
  players: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  player: { flex: 1 },
  right: { alignItems: 'flex-end' },
  progress: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  boardWrap: { alignItems: 'center', paddingVertical: 12, gap: 6 },
  boardPlaceholder: { borderRadius: 12 },
  pad: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  card: { borderRadius: 14, padding: 12, gap: 8 },
  shareRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  shareBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  votes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vote: { flexGrow: 1, flexBasis: '40%' },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reaction: { minHeight: 48, paddingHorizontal: 14, borderRadius: 24, borderWidth: 1, justifyContent: 'center', flexGrow: 1, alignItems: 'center' },
});
