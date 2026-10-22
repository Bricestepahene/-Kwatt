/**
 * Suivi d'un contrôleur de partie de dames par un écran : dernier état, dernier coup,
 * animation de la rafle (case par case), sons et vibrations, pendules.
 */
import { pliesUntilQuietDraw, type DamesState, type Move, type Piece } from '@kwatt/rules-dames';
import { useEffect, useRef, useState } from 'react';
import { playBoardFeedback } from '../../sound';
import type { GameController, GameEvent, SeatClock } from '../game/controller';

/** Méthodes facultatives qu'un contrôleur de dames peut offrir en plus du contrat commun. */
export interface DamesControllerExtras {
  lastMove?(): Move | null;
  isThinking?(): boolean;
  whenSaved?(): Promise<void>;
}

export type DamesController = GameController<DamesState, Move> & DamesControllerExtras;

/** Siège ↔ camp aux Dames : siège 0 = blancs, siège 1 = noirs. */
export const seatSide = (seat: number): 'w' | 'b' => (seat === 0 ? 'w' : 'b');
export const sideSeat = (side: 'w' | 'b'): number => (side === 'w' ? 0 : 1);

const HOP_MS = 170;

function moveOf(e: GameEvent | undefined): Move | null {
  const p = e?.params as Partial<Move> | undefined;
  if (!p || typeof p.from !== 'number' || typeof p.to !== 'number') return null;
  return { from: p.from, to: p.to, path: Array.isArray(p.path) ? p.path : [p.from, p.to], captures: Array.isArray(p.captures) ? p.captures : [] };
}

export interface DamesView {
  state: DamesState;
  /** Damier à dessiner (étape de rafle en cours, sinon l'état). */
  board: Piece[];
  /** Pièces prises pendant l'animation (estompées). */
  dimmed: number[];
  lastMove: Move | null;
  thinking: boolean;
  /** Dernier événement reçu (proposition de nulle, réaction…). */
  event: GameEvent | null;
  clocks: Record<number, SeatClock> | null;
  /** Demi-coups avant la nulle « seules les dames bougent ». */
  pliesToQuietDraw: number;
}

export function useDamesGame(controller: DamesController, options: { reduceMotion: boolean; mySide: 'w' | 'b' | null }): DamesView {
  const [state, setState] = useState<DamesState>(() => controller.getState());
  const [lastMove, setLastMove] = useState<Move | null>(() => controller.lastMove?.() ?? null);
  const [frame, setFrame] = useState<{ board: Piece[]; dimmed: number[] } | null>(null);
  const [thinking, setThinking] = useState<boolean>(() => controller.isThinking?.() ?? false);
  const [event, setEvent] = useState<GameEvent | null>(null);
  const [clocks, setClocks] = useState(() => controller.clock());
  const prevBoard = useRef<Piece[]>(controller.getState().board);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    const clear = () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
    const off = controller.subscribe((next, e) => {
      const move = moveOf(e);
      const before = prevBoard.current;
      prevBoard.current = next.board;
      setState(next);
      setThinking(controller.isThinking?.() ?? e?.kind === 'thinking');
      setClocks(controller.clock());
      if (e) setEvent(e);
      if (move) {
        setLastMove(move);
        // Rafle animée : le pion passe de case en case, les pièces prises s'estompent.
        clear();
        if (!opts.current.reduceMotion && move.path.length > 2) {
          const piece = before[move.from - 1] ?? '';
          for (let k = 1; k < move.path.length - 1; k++) {
            timers.current.push(
              setTimeout(() => {
                const b = [...before];
                b[move.from - 1] = '';
                b[move.path[k]! - 1] = piece;
                setFrame({ board: b, dimmed: move.captures.slice(0, k) });
              }, (k - 1) * HOP_MS),
            );
          }
          timers.current.push(setTimeout(() => setFrame(null), (move.path.length - 2) * HOP_MS));
          setFrame({ board: before, dimmed: [] });
        } else {
          setFrame(null);
        }
      }
      if (!e) return;
      // Sons et vibrations (préférences du joueur).
      if (e.kind === 'promotion') playBoardFeedback('promotion');
      else if (e.kind === 'capture') playBoardFeedback('capture');
      else if (e.kind === 'move') playBoardFeedback('move');
      else if (e.kind === 'invalid') playBoardFeedback('invalid');
      else if (e.kind === 'turn' && opts.current.mySide && next.turn === opts.current.mySide && !next.result) playBoardFeedback('yourTurn');
      else if (e.kind === 'end' && next.result && opts.current.mySide && next.result.winner === opts.current.mySide) playBoardFeedback('victory');
    });
    // L'état a pu changer entre le premier rendu et l'abonnement.
    setState(controller.getState());
    return () => {
      off();
      clear();
    };
  }, [controller]);

  // Pendules : relues régulièrement tant qu'une tourne.
  useEffect(() => {
    const running = clocks && Object.values(clocks).some((c) => c.running);
    if (!running) return;
    const id = setInterval(() => setClocks(controller.clock()), 500);
    return () => clearInterval(id);
  }, [controller, clocks]);

  return {
    state,
    board: frame?.board ?? state.board,
    dimmed: frame?.dimmed ?? [],
    lastMove: frame ? null : lastMove,
    thinking,
    event,
    clocks,
    pliesToQuietDraw: pliesUntilQuietDraw(state),
  };
}
