/**
 * Message du bas de l'écran de partie (planches 21, 21b, 21c) : « Un 4. Touche le pion à
 * jouer. », « Un seul coup possible : joué pour toi. », « Junior ne répond plus »…
 * Module pur : renvoie des clés du catalogue `ludo` et leurs paramètres.
 */
import { distinctMoves, legalMoves, partnersOf, pendingSteps, type LudoState } from '@kwatt/rules-ludo';
import type { GameEvent, SeatInfo } from '../game/controller';

export interface Phrase {
  key: string;
  params?: Record<string, string | number>;
}

export interface StatusMessage {
  bold: Phrase;
  text: Phrase | null;
  /** Indicateur du chrono : « auto » quand le coup est joué pour toi. */
  auto: boolean;
}

export interface StatusInput {
  state: LudoState;
  mySeats: readonly number[];
  seats: readonly SeatInfo[];
  /** Dernier événement reçu (lancer, coup). */
  last?: GameEvent | undefined;
  /** Coup unique joué tout seul (préférence). */
  autoPlaySingleMove: boolean;
}

function nameOf(seats: readonly SeatInfo[], seat: number): string {
  return seats.find((s) => s.seat === seat)?.name ?? '';
}

export function statusMessage({ state, mySeats, seats, last, autoPlaySingleMove }: StatusInput): StatusMessage {
  if (state.phase === 'over') return { bold: { key: 'msg.over' }, text: null, auto: false };
  const cowries = state.config.mechanics.throw === 'cowries';
  const mine = mySeats.includes(state.current);
  const lastValue = typeof last?.params?.value === 'number' ? (last.params.value as number) : null;

  // Mon lancer n'a donné aucun coup : le tour est passé (ou je relance après un 6).
  const myEmptyRoll = last?.kind === 'roll' && mySeats.includes(last.seat ?? -1) && last.params?.playable === 0 && lastValue !== null;
  if (myEmptyRoll && (!mine || state.phase === 'roll')) {
    return { bold: { key: 'msg.rolled', params: { count: lastValue } }, text: { key: mine ? 'msg.noMoveAgain' : 'msg.noMove' }, auto: false };
  }

  if (!mine) {
    const name = nameOf(seats, state.current);
    const info = seats.find((s) => s.seat === state.current);
    if (info?.connected === false) return { bold: { key: 'msg.away', params: { name } }, text: { key: 'msg.machinePlays' }, auto: false };
    if (mySeats.length === 0) return { bold: { key: 'msg.turnOf', params: { name } }, text: null, auto: false };
    if (last?.kind === 'roll' && last.seat === state.current && lastValue !== null) {
      return { bold: { key: 'msg.theirTurn', params: { name } }, text: { key: cowries ? 'msg.theyThrew' : 'msg.theyRolled', params: { count: lastValue } }, auto: false };
    }
    return { bold: { key: 'msg.theirTurn', params: { name } }, text: null, auto: false };
  }

  // Mon tour, avant de lancer : peut-être juste après un lancer sans coup ou un coup joué pour moi.
  if (state.phase === 'roll') {
    if (last?.kind === 'move' && last.params?.auto === true && mySeats.includes(last.seat ?? -1)) {
      return { bold: { key: 'msg.autoPlayedTitle' }, text: { key: cowries ? 'msg.throwAgain' : 'msg.rollAgain' }, auto: true };
    }
    return { bold: { key: 'msg.yourTurn' }, text: { key: cowries ? 'msg.throwCowries' : 'msg.rollDice' }, auto: false };
  }

  const steps = pendingSteps(state) ?? 0;
  const bonus = state.bonus.length > 0;
  const moves = distinctMoves(legalMoves(state));
  const bold: Phrase = bonus ? { key: 'msg.bonus', params: { count: steps } } : { key: 'msg.rolled', params: { count: steps } };
  if (moves.length === 1 && autoPlaySingleMove) return { bold, text: { key: 'msg.singleMove' }, auto: true };
  const partner = partnersOf(state, state.current)[0];
  if (partner !== undefined && state.turnNo <= 2 * state.seats.length) {
    return { bold, text: { key: 'msg.partner', params: { name: nameOf(seats, partner) } }, auto: false };
  }
  return { bold, text: { key: 'msg.touchToken' }, auto: false };
}

/** Pion jouable : celui qu'on peut toucher. Clé `seat:token`. */
export function playableKeys(moves: readonly { seat: number; token: number }[]): Set<string> {
  return new Set(moves.map((m) => `${m.seat}:${m.token}`));
}
