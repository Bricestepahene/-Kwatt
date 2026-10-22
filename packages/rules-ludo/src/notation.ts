/**
 * Notation d'une partie de Ludo (contrats C2 et C3) : une entrée par lancer ou par coup bonus.
 *
 * - « 6:2 »   : lancer de 6, puis le pion 2 du joueur au trait ;
 * - « 6:2.1 » : lancer de 6, puis le pion 1 du siège 2 (un partenaire joue pour l'autre) ;
 * - « 3:- »   : lancer de 3 sans coup possible (le tour est déjà passé) ;
 * - « b:0 »   : coup bonus du Parchís (+ 20 après une capture, + 10 après une rentrée), sans lancer.
 *
 * Même notation que le rejeu du serveur (module machine) : on enregistre en jouant
 * (`recordRoll`, `recordMove`) et on reconstruit une partie avec `replayNotation`
 * (reprise d'une partie locale, rejeu d'une partie terminée).
 */
import { applyMove, applyRoll, legalMoves, newGame, type LudoMove, type LudoState } from './engine.js';
import { LudoError } from './errors.js';
import type { NewGameOptions } from './variants.js';

/** Forme d'une entrée : lancer (ou « b »), deux-points, pion (ou « - »), siège facultatif. */
export const LUDO_NOTATION = /^(\d{1,2}|b):(-|\d)(?:\.(\d))?$/;

/** Ce que l'enregistreur garde : les entrées complètes et le lancer qui attend son coup. */
export interface NotationLog {
  moves: string[];
  pendingRoll: number | null;
}

export const emptyLog = (): NotationLog => ({ moves: [], pendingRoll: null });

/** Pion d'un coup, vu du joueur au trait : « 2 », ou « 1.3 » pour le pion 3 du siège 1. */
export function tokenNotation(state: Pick<LudoState, 'current'>, move: Pick<LudoMove, 'seat' | 'token'>): string {
  return move.seat === state.current ? String(move.token) : `${move.seat}.${move.token}`;
}

/**
 * Enregistre un lancer. `after` = état après `applyRoll(état, value)` : s'il reste un coup à
 * jouer, l'entrée attend ce coup ; sinon elle est close (« 3:- »).
 */
export function recordRoll(log: NotationLog, after: LudoState, value: number): NotationLog {
  if (after.phase === 'move') return { moves: log.moves, pendingRoll: value };
  return { moves: [...log.moves, `${value}:-`], pendingRoll: null };
}

/** Enregistre un coup joué depuis `before` (lancer en attente, sinon coup bonus « b: »). */
export function recordMove(log: NotationLog, before: LudoState, move: Pick<LudoMove, 'seat' | 'token'>): NotationLog {
  const head = log.pendingRoll === null ? 'b' : String(log.pendingRoll);
  return { moves: [...log.moves, `${head}:${tokenNotation(before, move)}`], pendingRoll: null };
}

/**
 * Rejoue une partie depuis sa notation (et un lancer en attente éventuel). Une entrée
 * illisible ou illégale lève une LudoError avec le numéro de l'entrée (`ply`).
 */
export function replayNotation(options: NewGameOptions, moves: readonly string[], pendingRoll: number | null = null): LudoState {
  let state = newGame(options);
  moves.forEach((text, ply) => {
    const m = LUDO_NOTATION.exec(text);
    if (!m) throw new LudoError('ludo.move.illegal', { ply, reason: 'format' });
    const [, roll, token, ofSeat] = m;
    if (roll === 'b') {
      if (state.phase !== 'move' || state.bonus.length === 0) throw new LudoError('ludo.move.not_now', { ply });
    } else {
      if (state.phase !== 'roll') throw new LudoError('ludo.roll.not_now', { ply });
      state = applyRoll(state, Number(roll));
    }
    if (token === '-') {
      if (state.phase === 'move' && legalMoves(state).length > 0) throw new LudoError('ludo.move.illegal', { ply, reason: 'skipped' });
      return;
    }
    if (state.phase !== 'move') throw new LudoError('ludo.move.not_now', { ply });
    const candidate = ofSeat !== undefined ? { seat: Number(token), token: Number(ofSeat) } : { seat: state.current, token: Number(token) };
    state = applyMove(state, candidate);
  });
  if (pendingRoll !== null) state = applyRoll(state, pendingRoll);
  return state;
}
