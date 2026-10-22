/**
 * Écrans 21, 21b, 21c · Partie de Ludo (contrat C5) : croix, étoile à 6, Parchís et Pachisi
 * (lancer de 6 cauris). L'écran reçoit un `GameController` et marche en local (machine hors
 * connexion) comme en distant (salon, ligue, machine en ligne, spectateur si `mySeats()` est
 * vide) : il affiche `getState()`, met en évidence les pions de `legalMoves()` et n'envoie que
 * des intentions (`roll`, `play`, `resign`).
 */
import { ludoSeats } from '@kwatt/design';
import { boardGeometry, BASE, distinctMoves, finish, lastTrack, teamOf, type LudoMove, type LudoState } from '@kwatt/rules-ludo';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDynamicT, useFormat } from '@/i18n';
import { updatePreferences, usePreferences } from '@/preferences';
import { ThemeSwitch } from '@/preferences/QuickSettings';
import { playBoardFeedback } from '@/sound';
import { useTheme } from '@/theme';
import { BottomSheet, Button, ConfirmSheet, Fabric, GameBand, Icon, IconButton, Text, Toggle } from '@/ui';
import type { GameController, GameEvent, SeatInfo } from '../game/controller';
import { LudoBoard, SeatGlyph } from './board/LudoBoard';
import type { TokenView } from './board/layout';
import { CowrieRow, CowrieTable } from './dice/Cowries';
import { Die } from './dice/Die';
import { shellsForValue } from './local/dice';
import { mechanicLines } from './mechanics';
import { statusMessage } from './messages';

export type LudoController = GameController<LudoState, LudoMove>;

interface LocalExtras {
  lastRoll?: () => { seat: number; value: number; shells?: boolean[] } | null;
  timeLeftMs?: () => number | null;
  canRoll?: () => boolean;
}

/** État et dernier événement d'un contrôleur, suivis en direct. */
function useControllerState(c: LudoController): { state: LudoState; last: GameEvent | undefined; rollId: number } {
  const [snap, setSnap] = useState<{ state: LudoState; last: GameEvent | undefined; rollId: number }>(() => ({ state: c.getState(), last: undefined, rollId: 0 }));
  useEffect(
    () =>
      c.subscribe((state, event) => {
        setSnap((prev) => ({
          state,
          last: event && (event.kind === 'roll' || event.kind === 'move') ? event : prev.last,
          rollId: event?.kind === 'roll' ? prev.rollId + 1 : prev.rollId,
        }));
      }),
    [c],
  );
  return snap;
}

/** Bandeaux du haut et du bas, rangés comme les maisons sur le plateau. */
function bannerRows(state: LudoState): [number[], number[]] {
  const seats = state.seats.map((_, i) => i);
  if (state.config.board === 'etoile') {
    const half = Math.ceil(seats.length / 2);
    return [seats.slice(0, half), seats.slice(half)];
  }
  const g = boardGeometry(state.config.board);
  const pos = (seat: number) => {
    const a = g.homeAreas[state.seats[seat]!.home]!;
    return a.kind === 'rect' ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : { x: a.cx, y: a.cy };
  };
  const top = seats.filter((s) => pos(s).y < g.center.y).sort((a, b) => pos(a).x - pos(b).x);
  const bottom = seats.filter((s) => pos(s).y >= g.center.y).sort((a, b) => pos(a).x - pos(b).x);
  return [top, bottom];
}

export function LudoGameScreen({ controller }: { controller: LudoController }) {
  const { t } = useTranslation('ludo');
  const td = useDynamicT();
  const f = useFormat();
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const diceAnimation = usePreferences((p) => p.diceAnimation);
  const autoPlay = usePreferences((p) => p.autoPlaySingleMove);
  const { state, last, rollId } = useControllerState(controller);
  const extras = controller as LudoController & LocalExtras;
  const mySeats = controller.mySeats();
  const seats = controller.seats();
  const [menu, setMenu] = useState(false);
  const [quit, setQuit] = useState(false);
  const [cowrieHelp, setCowrieHelp] = useState(false);
  const [, tick] = useState(0);
  const cowries = state.config.mechanics.throw === 'cowries';
  const geometry = useMemo(() => boardGeometry(state.config.board), [state.config.board]);

  // Le plateau prend le plus grand carré possible (bandeaux et commandes réservés).
  const reserved = (cowries ? 330 : 270) + insets.top + insets.bottom;
  const boardSize = Math.floor(Math.max(240, Math.min(width - 30, 560, height - reserved)));

  const legal = controller.legalMoves();
  const distinct = useMemo(() => distinctMoves(legal), [legal]);
  const myTurn = mySeats.includes(state.current) && state.phase !== 'over';
  const canRoll = extras.canRoll ? extras.canRoll() : myTurn && state.phase === 'roll';
  const message = statusMessage({ state, mySeats, seats, last, autoPlaySingleMove: autoPlay });
  const shownRoll = last?.kind === 'roll' && typeof last.params?.value === 'number' ? (last.params.value as number) : (extras.lastRoll?.()?.value ?? state.roll);
  const shells = (last?.kind === 'roll' && Array.isArray(last.params?.shells) ? (last.params.shells as boolean[]) : extras.lastRoll?.()?.shells) ?? (shownRoll !== null ? shellsForValue(shownRoll) : null);
  const clock = controller.clock();
  const remaining = clock?.[state.current];
  const timeLeft = extras.timeLeftMs?.() ?? null;

  // Pendules et fin au temps : rafraîchir l'affichage chaque seconde.
  useEffect(() => {
    if (!clock && timeLeft === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [clock !== null, timeLeft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sons : coup, prise, « à toi », victoire.
  useEffect(
    () =>
      controller.subscribe((s, e) => {
        if (!e) return;
        if (e.kind === 'move') playBoardFeedback(Number(e.params?.captures ?? 0) > 0 ? 'capture' : 'move');
        else if (e.kind === 'turn' && e.seat !== undefined && controller.mySeats().includes(e.seat)) playBoardFeedback('yourTurn');
        else if (e.kind === 'end') {
          const out = controller.outcome();
          const me = controller.mySeats()[0];
          if (out && me !== undefined && isWin(s, out.places, me)) playBoardFeedback('victory');
        }
      }),
    [controller],
  );

  // Fin de partie : écran 18 (contrat C4), après un court instant sur la position finale.
  const ended = useRef(false);
  useEffect(() => {
    if (state.phase !== 'over' || ended.current) return;
    ended.current = true;
    const id = setTimeout(() => router.replace(`/partie/${encodeURIComponent(controller.id)}/resultat` as Href), 1400);
    return () => clearTimeout(id);
  }, [state.phase, controller.id]);

  const exitMove = distinct.find((m) => m.from === BASE);
  const primary = (() => {
    if (state.phase === 'over') return { label: t('game.ended'), onPress: () => router.replace(`/partie/${encodeURIComponent(controller.id)}/resultat` as Href), disabled: false };
    if (canRoll) return { label: cowries ? t('game.throw') : t('game.roll'), onPress: () => controller.roll?.(), disabled: false };
    if (myTurn && distinct.length > 0) {
      if (exitMove) return { label: t('game.exit'), onPress: () => controller.play(exitMove), disabled: false };
      if (distinct.length === 1) return { label: t('game.advance'), onPress: () => controller.play(distinct[0]!), disabled: false };
      return { label: t('game.touch'), onPress: () => undefined, disabled: true };
    }
    return { label: t('game.wait'), onPress: () => undefined, disabled: true };
  })();

  const end = finish(state.config);
  const corridorStart = lastTrack(state.config) + 1;
  const colorName = (home: number) => td(`ludo:game.colors.${ludoSeats[home % ludoSeats.length]!.id}`);
  const tokenLabel = (v: TokenView) => {
    const p = state.tokens[v.seat]![v.token]!;
    const where = p === BASE ? 'base' : p >= corridorStart && p < end ? 'home' : 'track';
    return t('game.tokenLabel', { color: colorName(v.home), n: v.token + 1, where: td(`ludo:game.where.${where}`) });
  };
  const onTokenPress = (seat: number, token: number) => {
    const m = legal.find((x) => x.seat === seat && x.token === token);
    if (m) controller.play(m);
  };
  const [topRow, bottomRow] = bannerRows(state);
  const seatName = (seat: number) => (mySeats.includes(seat) ? t('game.you') : (seats.find((s) => s.seat === seat)?.name ?? ''));
  const teams = state.config.teams;
  const boardLabel = t('game.boardLabel', { count: state.seats.length, colors: state.seats.map((s) => colorName(s.home)).join(', ') });

  // Rangée plus courte que l'autre : des places vides gardent la largeur des bandeaux.
  const fill = (n: number, other: number) => Array.from({ length: Math.max(0, Math.max(2, other) - n) }, (_, i) => <View key={`f${i}`} style={styles.flex} />);
  const banner = (seat: number) => (
    <PlayerBanner key={seat} seat={seat} state={state} info={seats.find((s) => s.seat === seat)} name={seatName(seat)} mySeats={mySeats} />
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <GameBand space="ludo" />
      <View style={styles.topLine}>
        {cowries && teams.length === 2 ? (
          <View style={styles.flex}>
            <Text variant="section" tone="action">
              {t('game.pachisiTitle')}
            </Text>
            <Text variant="small" numberOfLines={1}>
              {t('game.pachisiTeams', {
                a: seatName(teams[0]![0]!),
                b: seatName(teams[0]![1]!),
                c: seatName(teams[1]![0]!),
                d: seatName(teams[1]![1]!),
              })}
            </Text>
          </View>
        ) : (
          <View style={styles.flex} />
        )}
        {timeLeft !== null ? (
          <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="clock" size={14} color={colors.textMuted} />
            <Text variant="smallStrong">{t('game.timeLeft', { time: f.clock(timeLeft) })}</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.banners, topRow.length === 3 || bottomRow.length === 3 ? styles.three : null]}>
        {topRow.map(banner)}
        {fill(topRow.length, bottomRow.length)}
      </View>
      <View style={styles.boardWrap}>
        <LudoBoard
          state={state}
          geometry={geometry}
          highlighted={legal}
          onTokenPress={onTokenPress}
          size={boardSize}
          tokenLabel={tokenLabel}
          accessibilityLabel={boardLabel}
        />
      </View>
      <View style={[styles.banners, topRow.length === 3 || bottomRow.length === 3 ? styles.three : null]}>
        {bottomRow.map(banner)}
        {fill(bottomRow.length, topRow.length)}
      </View>

      <View style={styles.bottom}>
        {cowries ? (
          <Fabric name="obom" style={styles.cowrieCard}>
            {shells ? (
              <CowrieRow shells={shells} width={20} accessibilityLabel={t('game.cowriesAlt', { count: shells.filter(Boolean).length })} />
            ) : (
              <CowrieRow shells={[false, false, false, false, false, false]} width={20} accessibilityLabel={t('game.cowriesWaiting')} />
            )}
            <View style={[styles.cowrieValue, { backgroundColor: colors.bg }]}>
              <Text variant="subheading" tone="action" numberOfLines={1}>
                {shownRoll !== null ? t('game.cases', { count: shownRoll }) : '—'}
              </Text>
            </View>
            <IconButton icon="help" tone="bg" accessibilityLabel={t('game.cowriesHelpButton')} onPress={() => setCowrieHelp(true)} size={48} />
          </Fabric>
        ) : null}
        <View style={styles.controls}>
          {!cowries ? (
            <Die
              value={shownRoll}
              rollId={rollId}
              animation={diceAnimation}
              reduceMotion={reduceMotion}
              accessibilityLabel={shownRoll !== null ? t('game.die', { value: shownRoll }) : t('game.dieWaiting')}
            />
          ) : null}
          <View style={styles.flex}>
            <View style={styles.message} accessibilityLiveRegion="polite">
              {remaining || message.auto ? (
                <View
                  accessible
                  accessibilityLabel={message.auto ? t('game.auto') : t('game.timer')}
                  style={[styles.timer, { borderColor: message.auto ? colors.gain : remaining?.running ? colors.action : colors.border }]}
                >
                  <Text variant="smallStrong" style={styles.timerText} tone={message.auto ? 'gain' : 'default'}>
                    {message.auto ? t('game.auto') : `${Math.ceil((remaining?.remainingMs ?? 0) / 1000)} s`}
                  </Text>
                </View>
              ) : null}
              <Text variant="label" style={styles.flex}>
                <Text variant="labelStrong">{td(`ludo:${message.bold.key}`, message.bold.params)}</Text>
                {message.text ? ` ${td(`ludo:${message.text.key}`, message.text.params)}` : ''}
              </Text>
            </View>
            <View style={styles.buttons}>
              {mySeats.length > 0 ? (
                <Button label={primary.label} size="sm" variant={primary.disabled ? 'secondary' : 'primary'} onPress={primary.onPress} disabled={primary.disabled} style={styles.flex} />
              ) : (
                <View style={styles.flex} />
              )}
              <IconButton icon="more" accessibilityLabel={t('game.menu')} onPress={() => setMenu(true)} size={48} />
            </View>
          </View>
        </View>
      </View>

      <GameMenu
        visible={menu}
        state={state}
        canQuit={mySeats.length > 0 && state.phase !== 'over'}
        onClose={() => setMenu(false)}
        onQuit={() => {
          setMenu(false);
          setQuit(true);
        }}
      />
      <ConfirmSheet
        visible={quit}
        title={t('game.quitTitle')}
        message={t('game.quitMessage')}
        confirmLabel={t('game.quitConfirm')}
        cancelLabel={t('game.keepPlaying')}
        onCancel={() => setQuit(false)}
        onConfirm={() => {
          setQuit(false);
          controller.resign();
        }}
      />
      <BottomSheet visible={cowrieHelp} onClose={() => setCowrieHelp(false)} accessibilityLabel={t('game.cowriesTable')}>
        <Text variant="section" tone="muted">
          {t('game.cowriesTable')}
        </Text>
        <CowrieTable up={shells ? shells.filter(Boolean).length : null} openingsLabel={(n) => t('game.openingsShort', { count: n })} />
        <Text variant="small" tone="muted">
          {t('game.cowriesHelp')}
        </Text>
        <Button variant="secondary" label={t('game.close')} onPress={() => setCowrieHelp(false)} />
      </BottomSheet>
    </View>
  );
}

/** Le siège (ou son équipe) a-t-il gagné ? */
export function isWin(state: LudoState, places: Record<number, number>, seat: number): boolean {
  if (state.config.teams.length === 0) return places[seat] === 1;
  const sum = (team: number[]) => team.reduce((s, x) => s + (places[x] ?? state.seats.length), 0);
  const mine = state.config.teams[teamOf(state, seat)];
  if (!mine) return places[seat] === 1;
  return state.config.teams.every((team) => team === mine || sum(mine) < sum(team));
}

function PlayerBanner({ seat, state, info, name, mySeats }: { seat: number; state: LudoState; info: SeatInfo | undefined; name: string; mySeats: readonly number[] }) {
  const { t } = useTranslation('ludo');
  const { colors } = useTheme();
  const home = state.seats[seat]!.home;
  const color = ludoSeats[home % ludoSeats.length]!.color;
  const mine = mySeats.includes(seat);
  const current = state.current === seat && state.phase !== 'over';
  const teamsMode = state.config.teams.length > 0;
  const me = mySeats[0];
  const partner = teamsMode && me !== undefined && !mine && teamOf(state, seat) === teamOf(state, me);
  const homeCount = state.tokens[seat]!.filter((p) => p === finish(state.config)).length;
  const place = state.ranking.indexOf(seat);
  const away = info?.connected === false;
  const status = state.seats[seat]!.status;

  let tag = '';
  let tone: 'action' | 'muted' | 'default' = 'muted';
  if (current && mine) {
    tag = teamsMode ? t('game.tags.yourTurnTeam') : t('game.tags.yourTurn');
    tone = 'action';
  } else if (away) {
    tag = t('game.tags.away');
    tone = 'action';
  } else if (status === 'out') tag = t('game.tags.out');
  else if (status === 'finished' && place >= 0) tag = place === 0 ? t('game.tags.finishedFirst') : t('game.tags.finished', { place: place + 1 });
  else if (current) tag = t('game.tags.playing');
  else if (teamsMode && me !== undefined && !mine) tag = partner ? t('game.tags.partner') : t('game.tags.opponents');
  else if (homeCount > 0) tag = t('game.tags.home', { count: homeCount });
  else if (info?.machine) tag = t('game.tags.machine');
  if (partner && !current) tone = 'default';

  const border = away
    ? { borderWidth: 2, borderStyle: 'dashed' as const, borderColor: colors.action }
    : current
      ? { borderWidth: 2, borderColor: color }
      : partner
        ? { borderWidth: 2, borderColor: ludoSeats[state.seats[me!]!.home % ludoSeats.length]!.color }
        : { borderWidth: 1, borderColor: colors.border };
  return (
    <View
      accessible
      accessibilityLabel={[name, tag].filter(Boolean).join(', ')}
      style={[styles.banner, { backgroundColor: colors.surface }, border]}
    >
      <SeatGlyph home={home} size={12} />
      <Text variant="smallStrong" numberOfLines={1} style={styles.bannerName}>
        {name}
      </Text>
      {tag ? (
        <Text variant="caption" tone={tone} numberOfLines={1} style={styles.bannerTag}>
          {tag}
        </Text>
      ) : null}
    </View>
  );
}

function GameMenu({ visible, state, canQuit, onClose, onQuit }: { visible: boolean; state: LudoState; canQuit: boolean; onClose: () => void; onQuit: () => void }) {
  const { t } = useTranslation('ludo');
  const td = useDynamicT();
  const { colors } = useTheme();
  const soundPack = usePreferences((p) => p.soundPack);
  const lastPack = useRef(soundPack === 'silence' ? 'balafon' : soundPack);
  const lines = mechanicLines({ preset: state.config.preset, house: state.config.house });
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('game.menuTitle')}>
      <Text variant="title" accessibilityRole="header">
        {t('game.menuTitle')}
      </Text>
      <View style={[styles.menuRules, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <Text variant="labelStrong">
          {td(`ludo:board.${state.config.preset}.name`)}
          {state.config.house ? ` · ${t('game.houseRules')}` : ''}
        </Text>
        {lines.slice(0, 5).map((l) => (
          <Text key={l.row} variant="caption" tone={l.changed ? 'action' : 'muted'}>
            {`${td(`ludo:mech.rows.${l.row}`)} : ${td(`ludo:${l.valueKey}`, l.params)}`}
          </Text>
        ))}
      </View>
      <View style={styles.menuRow}>
        <Icon name="volume" size={20} color={colors.text} />
        <Text variant="label" style={styles.flex}>
          {t('game.sound')}
        </Text>
        <Toggle
          value={soundPack !== 'silence'}
          accessibilityLabel={t('game.sound')}
          onChange={(on) => {
            if (!on && soundPack !== 'silence') lastPack.current = soundPack;
            updatePreferences({ soundPack: on ? lastPack.current : 'silence' });
          }}
        />
      </View>
      <ThemeSwitch withNote={false} />
      <Pressable accessibilityRole="link" onPress={() => { onClose(); router.push('/regles/ludo' as Href); }} style={styles.menuRow}>
        <Icon name="book" size={20} color={colors.text} />
        <Text variant="label" style={styles.flex}>
          {t('game.readRules')}
        </Text>
        <Icon name="chevronRight" size={18} color={colors.textMuted} />
      </Pressable>
      {canQuit ? <Button variant="danger" size="sm" label={t('game.quit')} onPress={onQuit} /> : null}
      <Button variant="ghost" label={t('game.close')} onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topLine: { minHeight: 40, paddingHorizontal: 16, paddingTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  banners: { flexDirection: 'row', gap: 8, paddingHorizontal: 15, paddingVertical: 8 },
  three: { gap: 6 },
  banner: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, minHeight: 40 },
  bannerName: { flexShrink: 0, maxWidth: '64%' },
  bannerTag: { marginLeft: 'auto', flexShrink: 1, textAlign: 'right' },
  boardWrap: { alignItems: 'center' },
  bottom: { marginTop: 'auto', paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  cowrieCard: { borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cowrieValue: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 'auto' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  message: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  timer: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  timerText: { fontSize: 10, lineHeight: 12 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  menuRules: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
});
