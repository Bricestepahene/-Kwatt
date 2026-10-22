/**
 * Écran de partie de dames (contrat C5 ; écrans 16, 16b, 43) : prend un GameController et
 * marche en local (machine hors connexion) comme en distant (salon, ligue, machine avec pari,
 * spectateur si `mySeats()` est vide).
 *
 *   <DamesGameScreen controller={controller} />
 *
 * Téléphone : bandeau de l'adversaire, damier, consigne (« Prise obligatoire », « Nulle
 * automatique dans N coups »), ton bandeau et le menu. Tablette (≥ 900 px, planche
 * TabletteDames) : damier au centre, panneau des joueurs à droite.
 * Sièges : 0 = blancs, 1 = noirs ; on joue toujours avec ses pièces en bas.
 */
import { legalMoves as rulesLegalMoves, type DamesState, type Move } from '@kwatt/rules-dames';
import type { PlayerLook } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFormat } from '../../i18n';
import { getPreferences, updatePreferences, usePreferences } from '../../preferences';
import { useTheme } from '../../theme';
import { brand, checkers } from '@kwatt/design';
import { playBoardFeedback } from '../../sound';
import { Avatar, BottomSheet, ConfirmSheet, Icon, IconButton, Text, showToast, type AvatarSpec } from '../../ui';
import type { GameOutcome, SeatInfo } from '../game/controller';
import { avatarProps } from '../profile/looks';
import { DamesBoard } from './board/DamesBoard';
import { material } from './board/geometry';
import { EMPTY_SELECTION, captureRequired, movablePieces, tap, targetsOf, threatened, type Selection } from './board/selection';
import { seatSide, useDamesGame, type DamesController } from './useDamesGame';

export interface DamesGameScreenProps {
  controller: DamesController;
  /** Fin de partie : par défaut, l'écran 18 (/partie/<id>/resultat). */
  onEnd?: (outcome: GameOutcome) => void;
  /** Mise par joueur (menu : « Pot … cauris »). */
  stake?: number;
  /** Pendule : base et incrément (menu « 5 min + 3 s par coup »). */
  clockSetting?: { baseMs: number; incrementMs: number };
}

const REACTIONS = ['ekie', 'doucement', 'tu_dors', 'weee', 'bravo', 'revanche'] as const;
const TABLET_MIN = 900;
const ASIDE = 330;

let soundBeforeMute: 'balafon' | 'tamtam' = 'balafon';

/** Avatar d'un siège : apparence du serveur (PlayerLook) ou initiale. */
function seatAvatar(seat: SeatInfo | undefined): { avatar: AvatarSpec; frame: ReturnType<typeof avatarProps>['frame'] } {
  const look = seat?.avatar as PlayerLook | undefined;
  if (look && typeof look === 'object' && 'avatar' in look) {
    const p = avatarProps(look);
    return { avatar: p.avatar, frame: p.frame };
  }
  return { avatar: { kind: 'initial' }, frame: null };
}

export function DamesGameScreen({ controller, onEnd, stake = 0, clockSetting }: DamesGameScreenProps) {
  const { t } = useTranslation('dames');
  const { t: tc } = useTranslation('common');
  const f = useFormat();
  const { colors, reduceMotion, isSun } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const showNumbers = usePreferences((p) => p.boardNumbers);
  const soundPack = usePreferences((p) => p.soundPack);

  const mySeats = controller.mySeats();
  const mySeat = mySeats[0] ?? null;
  const mySide = mySeat === null ? null : seatSide(mySeat);
  const seats = controller.seats();
  const me = seats.find((s) => s.seat === mySeat) ?? seats.find((s) => s.seat === 0);
  const opponent = seats.find((s) => s.seat !== (me?.seat ?? 0));
  const meSide = me ? seatSide(me.seat) : 'w';
  const oppSide = meSide === 'w' ? 'b' : 'w';
  const flipped = meSide === 'b';
  const vsMachine = Boolean(opponent?.machine);

  const view = useDamesGame(controller, { reduceMotion, mySide });
  const { state } = view;
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [menu, setMenu] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [reactions, setReactions] = useState(false);
  const [drawOffer, setDrawOffer] = useState<string | null>(null);
  const [drawSent, setDrawSent] = useState(false);
  const ended = useRef(false);

  const legal = useMemo(() => (mySeat === null ? [] : controller.legalMoves()), [controller, state, view.thinking, mySeat]);
  const myTurn = mySide !== null && state.turn === mySide && !state.result;
  const mustCapture = myTurn && captureRequired(legal);

  // Sélection remise à zéro quand l'état change (coup joué, état du serveur).
  useEffect(() => setSelection(EMPTY_SELECTION), [state]);

  // Événements : proposition de nulle, réactions.
  useEffect(() => {
    const e = view.event;
    if (!e) return;
    if (e.kind === 'draw_offer' && e.seat !== mySeat) setDrawOffer(opponent?.name ?? '');
    if (e.kind === 'draw_declined' && e.seat !== mySeat) showToast(t('game.drawRefused'));
    if (e.kind === 'reaction' && e.seat !== mySeat) {
      const key = String((e.params as { key?: string } | undefined)?.key ?? '').replace(/^reaction\./, '');
      if ((REACTIONS as readonly string[]).includes(key)) {
        const who = seats.find((s) => s.seat === e.seat)?.name ?? '';
        showToast(t('game.reactionFrom', { name: who, reaction: tc(`reaction.${key as (typeof REACTIONS)[number]}`) }));
      }
    }
  }, [view.event]);

  // Fin de partie : l'écran 18, une fois la partie gardée.
  useEffect(() => {
    if (!state.result || ended.current) return;
    ended.current = true;
    const outcome = controller.outcome();
    const timer = setTimeout(
      () => {
        void (controller.whenSaved?.() ?? Promise.resolve()).then(() => {
          if (onEnd && outcome) onEnd(outcome);
          else router.replace(`/partie/${encodeURIComponent(controller.id)}/resultat` as Href);
        });
      },
      reduceMotion ? 300 : 1200,
    );
    return () => clearTimeout(timer);
  }, [state.result]);

  const onSquare = useCallback(
    (square: number) => {
      if (!myTurn) return;
      const r = tap(legal, selection, square);
      if (r.kind === 'play') {
        setSelection(EMPTY_SELECTION);
        controller.play(r.move);
      } else if (r.kind === 'invalid') {
        if (selection.from !== null || state.board[square - 1] !== '') playFeedbackInvalid();
        setSelection(r.selection);
      } else setSelection(r.selection);
    },
    [legal, selection, myTurn, controller, state],
  );

  // Mise en page.
  const tablet = width >= TABLET_MIN;
  const boardSize = tablet
    ? Math.min(height - insets.top - insets.bottom - 32, width - ASIDE - 32)
    : Math.min(width - 10, height - insets.top - insets.bottom - 230);

  const targets = targetsOf(legal, selection);
  const hint = hintLine();

  function hintLine(): { text: string; tone: 'action' | 'alert' } | null {
    if (state.result) return { text: t('game.ended'), tone: 'action' };
    if (selection.via.length > 0) return { text: t('game.chooseVia'), tone: 'action' };
    if (mustCapture) return { text: state.variant === 'dames8' ? t('game.mustCaptureForward') : t('game.mustCapture'), tone: 'action' };
    if (state.quietKingPlies > 0 && view.pliesToQuietDraw <= 20) {
      return { text: t('game.quietDraw', { count: Math.ceil(view.pliesToQuietDraw / 2) }), tone: 'alert' };
    }
    if (mySeat === null) return { text: t('game.spectating'), tone: 'action' };
    return null;
  }

  const moveNumber = Math.floor(state.ply / 2) + 1;
  const clockOf = (seat: number | undefined) => (seat === undefined ? null : (view.clocks?.[seat] ?? null));

  const band = (seat: SeatInfo | undefined, side: 'w' | 'b', mine: boolean) => {
    const m = material(view.board, side);
    const count = m.kings > 0 ? t('game.menKings', { men: m.men, count: m.kings }) : t('game.men', { count: m.men });
    const active = state.turn === side && !state.result;
    const clock = clockOf(seat?.seat);
    const name = mine && mySeat !== null ? (active ? t('game.yourTurn') : t('game.you')) : (seat?.name ?? '');
    const status =
      !mine && view.thinking && active ? t('game.thinking', { name: seat?.name ?? '' }) : mine || tablet ? count : null;
    return { seat, side, mine, count, pieces: m.men + m.kings, active, clock, name, status };
  };
  const top = band(opponent, oppSide, false);
  const bottom = band(me, meSide, true);

  const menuItems = (
    <View style={styles.menu}>
      <View style={styles.menuInfo}>
        <Text variant="small" tone="muted" style={styles.flex} numberOfLines={2}>
          {vsMachine
            ? t('game.menuInfoMachine', { difficulty: t(`difficulty.${(opponent?.machine?.difficulty ?? 'facile') as 'facile'}`), move: moveNumber })
            : `${t('game.menuInfo', { variant: t(`variant.${state.variant}.short`), move: moveNumber })}${
                clockSetting ? ` · ${t('game.menuClock', { base: Math.round(clockSetting.baseMs / 60000), inc: Math.round(clockSetting.incrementMs / 1000) })}` : ''
              }`}
        </Text>
        {stake > 0 ? (
          <Text variant="small" tone="muted">
            {t('game.pot')}{' '}
            <Text variant="smallStrong" tone="action">
              {f.cauris(stake * 2)}
            </Text>
          </Text>
        ) : null}
      </View>
      {controller.offerDraw && !vsMachine && mySeat !== null && !state.result ? (
        <MenuAction
          label={drawSent ? t('game.drawOffered') : t('game.offerDraw')}
          disabled={drawSent}
          onPress={() => {
            controller.offerDraw?.();
            setDrawSent(true);
            setMenu(false);
          }}
        />
      ) : null}
      {controller.react && controller.kind === 'remote' && mySeat !== null ? (
        <MenuAction label={t('game.react')} onPress={() => (setMenu(false), setReactions(true))} />
      ) : null}
      <MenuAction
        label={t('game.numbers', { state: showNumbers ? t('game.numbersOn') : t('game.numbersOff') })}
        onPress={() => updatePreferences({ boardNumbers: !showNumbers })}
      />
      <MenuAction
        label={soundPack === 'silence' ? t('game.unmute') : t('game.mute')}
        onPress={() => {
          const pack = getPreferences().soundPack;
          if (pack === 'silence') updatePreferences({ soundPack: soundBeforeMute });
          else {
            soundBeforeMute = pack;
            updatePreferences({ soundPack: 'silence' });
          }
        }}
      />
      <MenuAction label={isSun ? t('game.night') : t('game.sun')} onPress={() => updatePreferences({ theme: isSun ? 'night' : 'sun' })} />
      <MenuAction
        label={state.variant === 'dames8' ? t('game.rules8') : t('game.rules10')}
        onPress={() => (setMenu(false), router.push(`/regles/${state.variant === 'dames8' ? 'dames8' : 'dames'}` as Href))}
      />
      {opponent?.userId && mySeat !== null ? (
        <MenuAction
          label={t('game.report')}
          onPress={() => (setMenu(false), router.push(`/signaler/${encodeURIComponent(opponent.userId!)}` as Href))}
        />
      ) : null}
      {mySeat !== null && !state.result ? (
        <MenuAction label={t('game.resign')} tone="alert" onPress={() => (setMenu(false), setConfirmResign(true))} />
      ) : null}
    </View>
  );

  const menuButton = (
    <IconButton
      icon="more"
      accessibilityLabel={t('game.menuA11y')}
      accessibilityState={{ expanded: menu }}
      size={tablet ? 52 : 48}
      onPress={() => setMenu(true)}
      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14 }}
    />
  );

  const board = (
    <DamesBoard
      state={{ variant: state.variant, board: view.board }}
      selected={selection.from}
      targets={targets}
      lastMove={view.lastMove}
      threatened={threatened(legal, selection)}
      mustCapture={mustCapture && selection.from === null ? movablePieces(legal) : []}
      dimmed={view.dimmed}
      onSquarePress={onSquare}
      flipped={flipped}
      showNumbers={showNumbers}
      size={boardSize}
      interactive={mySeat !== null}
      accessibilityLabel={t('board.labelVariant', { size: state.variant === 'dames8' ? 8 : 10 })}
      testID="dames-board"
    />
  );

  const hintView = (
    <Text variant="smallStrong" tone={hint?.tone ?? 'action'} align="center" style={styles.hint} accessibilityLiveRegion="polite" numberOfLines={2}>
      {hint?.text ?? ''}
    </Text>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="dames-game">
      {tablet ? (
        <View style={styles.tablet}>
          <View style={styles.tabletMain}>{board}</View>
          <View style={[styles.aside, { backgroundColor: colors.surface, borderLeftColor: colors.border }]}>
            <View style={styles.flex} />
            <PlayerCard info={top} />
            <PlayerCard info={bottom} />
            {hintView}
            <View style={styles.flex} />
            <View style={styles.asideMenu}>{menuButton}</View>
          </View>
        </View>
      ) : (
        <View style={styles.phone}>
          <PlayerBand info={top} />
          <View style={styles.center}>{board}</View>
          {hintView}
          <PlayerBand info={bottom} right={menuButton} />
        </View>
      )}

      <BottomSheet visible={menu} onClose={() => setMenu(false)} accessibilityLabel={t('game.menu')}>
        {menuItems}
      </BottomSheet>
      <ConfirmSheet
        visible={confirmResign}
        title={t('game.resignTitle')}
        message={stake > 0 ? t('game.resignMessageBet') : t('game.resignMessage')}
        confirmLabel={t('game.resignConfirm')}
        cancelLabel={t('game.keepPlaying')}
        tone="danger"
        onConfirm={() => {
          setConfirmResign(false);
          controller.resign();
        }}
        onCancel={() => setConfirmResign(false)}
      />
      <ConfirmSheet
        visible={drawOffer !== null}
        title={t('game.drawProposedTitle', { name: drawOffer ?? '' })}
        confirmLabel={t('game.drawAccept')}
        cancelLabel={t('game.drawRefuse')}
        tone="primary"
        onConfirm={() => {
          controller.answerDraw?.(true);
          setDrawOffer(null);
        }}
        onCancel={() => {
          controller.answerDraw?.(false);
          setDrawOffer(null);
        }}
      />
      <BottomSheet visible={reactions} onClose={() => setReactions(false)} accessibilityLabel={t('game.reactionsTitle')}>
        <Text variant="subheading">{t('game.reactionsTitle')}</Text>
        <View style={styles.reactions}>
          {REACTIONS.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              onPress={() => {
                controller.react?.(`reaction.${key}`);
                setReactions(false);
              }}
              style={({ pressed }) => [styles.reaction, { backgroundColor: colors.bg, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text variant="bodyStrong" align="center">
                {tc(`reaction.${key}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

/** Coup refusé : vibration courte (planche Matrice), pas de son. */
function playFeedbackInvalid() {
  playBoardFeedback('invalid');
}

interface BandInfo {
  seat: SeatInfo | undefined;
  side: 'w' | 'b';
  mine: boolean;
  count: string;
  pieces: number;
  active: boolean;
  clock: { remainingMs: number; running: boolean } | null;
  name: string;
  status: string | null;
}

function PieceAvatar({ info, size }: { info: BandInfo; size: number }) {
  const { colors, isSun } = useTheme();
  const a = seatAvatar(info.seat);
  const machine = Boolean(info.seat?.machine);
  if (machine) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: checkers.black.fill,
          borderWidth: 2,
          borderColor: isSun ? checkers.black.ringSun : checkers.black.ringNight,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="machine" size={Math.round(size * 0.55)} color={brand.raphia} />
      </View>
    );
  }
  return (
    <Avatar
      name={machine ? 'M' : (info.seat?.name ?? '?')}
      avatar={machine ? { kind: 'initial' } : a.avatar}
      frame={a.frame}
      size={size}
      decorative
      {...(info.mine && info.active ? { ringColor: colors.action } : {})}
    />
  );
}

function ClockText({ info, large }: { info: BandInfo; large: boolean }) {
  const { t } = useTranslation('dames');
  const f = useFormat();
  if (!info.clock) return null;
  const time = f.clock(info.clock.remainingMs);
  return (
    <Text
      variant={large ? 'numberLarge' : 'number'}
      tone={info.active && info.mine ? 'action' : 'muted'}
      style={styles.clock}
      accessibilityLabel={t('game.clockA11y', { time })}
    >
      {time}
    </Text>
  );
}

/** Bandeau d'un joueur (téléphone) : avatar, nom, pièces restantes, pendule. */
function PlayerBand({ info, right }: { info: BandInfo; right?: React.ReactNode }) {
  return (
    <View style={[styles.band, !info.mine ? styles.dim : null]}>
      <PieceAvatar info={info} size={info.mine ? 40 : 34} />
      <View style={styles.bandText}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {info.name}
        </Text>
        {info.status ? (
          <Text variant="small" tone="muted" numberOfLines={1}>
            {info.status}
          </Text>
        ) : null}
      </View>
      {!info.mine ? (
        <Text variant="small" tone="muted">
          {info.pieces}
        </Text>
      ) : null}
      <View style={styles.flex} />
      <ClockText info={info} large={info.mine} />
      {right}
    </View>
  );
}

/** Carte d'un joueur (tablette). */
function PlayerCard({ info }: { info: BandInfo }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.bg },
        info.active && info.mine ? { borderWidth: 2, borderColor: colors.text } : null,
      ]}
    >
      <PieceAvatar info={info} size={42} />
      <View style={styles.bandText}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {info.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {info.status ?? info.count}
        </Text>
      </View>
      <View style={styles.flex} />
      <ClockText info={info} large={false} />
    </View>
  );
}

function MenuAction({ label, onPress, tone, disabled }: { label: string; onPress: () => void; tone?: 'alert'; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: colors.bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <Text variant="bodyStrong" tone={tone ?? 'default'} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Coups légaux d'un état (spectateur, revoir) sans contrôleur. */
export function legalFor(state: DamesState): Move[] {
  return rulesLegalMoves(state);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  phone: { flex: 1, justifyContent: 'center', gap: 18, paddingVertical: 12 },
  center: { alignItems: 'center' },
  hint: { minHeight: 18, paddingHorizontal: 16 },
  band: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 48 },
  dim: { opacity: 0.8 },
  bandText: { flexShrink: 1, gap: 1 },
  clock: { fontVariant: ['tabular-nums'] },
  tablet: { flex: 1, flexDirection: 'row' },
  tabletMain: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  aside: { width: ASIDE, borderLeftWidth: 1, paddingHorizontal: 22, paddingVertical: 24, gap: 14 },
  asideMenu: { alignItems: 'flex-end' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12 },
  menu: { gap: 8 },
  menuInfo: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingHorizontal: 4, paddingBottom: 6 },
  action: { minHeight: 52, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reaction: { minHeight: 52, minWidth: '30%', flexGrow: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
});

