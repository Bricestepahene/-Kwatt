/**
 * Partie de dames contre la machine, jouée sur l'appareil (contrôleur `local`, SPEC §9).
 *
 * - Le joueur a les blancs (siège 0, en bas, comme les écrans 16 et 16b) ; la machine a les
 *   noirs (siège 1). En 8×8, les noirs commencent : la machine joue la première.
 * - La machine est @kwatt/engine-dames `chooseMove` (asynchrone, découpé), avec la force
 *   visée de l'offre (`targetRating`) et une graine tirée au lancement, SANS limite de
 *   temps : le serveur rejoue chaque coup de la machine à l'identique (contrat C2).
 * - L'état est gardé à chaque coup (stockage injecté) : la partie reprend après la fermeture
 *   de l'appli.
 * - À la fin, `onFinished` reçoit la partie au format de l'historique local (C4).
 */
import { chooseMove, SearchCancelledError } from '@kwatt/engine-dames';
import {
  applyMove,
  findLegal,
  initialState,
  legalMoves,
  parseNotation,
  resign as resignState,
  toNotation,
  type DamesState,
  type Move,
  type Variant,
} from '@kwatt/rules-dames';
import { readJson, writeJson, type KeyValueStore } from '../../storage/kv';
import type { GameController, GameEvent, GameOutcome, SeatClock, SeatInfo } from '../game/controller';
import type { LocalGame } from '../game/historyStore';

export const LOCAL_DAMES_KEY = 'kwatt.dames.local.v1';
/** Siège du joueur (blancs) et de la machine (noirs). */
export const PLAYER_SEAT = 0;
export const MACHINE_SEAT = 1;

export type MachineDifficulty = 'facile' | 'moyen' | 'coriace' | 'ton_niveau' | 'fon';

export interface LocalDamesOptions {
  id: string;
  variant: Variant;
  difficulty: MachineDifficulty;
  mode: 'auto' | 'chosen';
  /** Force visée par la machine (offre du serveur, `machineRating`). */
  machineRating: number;
  /** Graine de la machine (entier 32 bits non signé). */
  seed: number;
  player: { userId: string | null; name: string; avatar?: unknown };
  /** Nom affiché de la machine (traduit par l'écran de lancement). */
  machineName: string;
  startedAt: string;
}

/** Ce qui est gardé sur l'appareil pour reprendre la partie. */
export interface LocalDamesSnapshot {
  options: LocalDamesOptions;
  moves: string[];
  resigned: boolean;
}

export interface LocalDamesDeps {
  storage: KeyValueStore;
  /** Appelé une fois, à la fin de la partie (sauvegarde, envoi au serveur). */
  onFinished?: (game: LocalGame) => void | Promise<void>;
  /** Attente minimale avant le coup de la machine (ms), pour qu'on la voie jouer. */
  machineDelayMs?: number;
  now?: () => number;
  /** Moteur injectable (tests). */
  engine?: typeof chooseMove;
}

const sideOfSeat = (seat: number) => (seat === PLAYER_SEAT ? 'w' : 'b');

/** Rejoue une liste de coups (notation officielle) depuis la position de départ. */
export function replayNotation(variant: Variant, moves: readonly string[]): { state: DamesState; played: Move[] } {
  let state = initialState(variant);
  const played: Move[] = [];
  for (const text of moves) {
    const m = parseNotation(state, text);
    if (!m) throw new Error(`Coup illisible : ${text}`);
    played.push(m);
    state = applyMove(state, m);
  }
  return { state, played };
}

export function outcomeOf(state: DamesState): GameOutcome | null {
  if (!state.result) return null;
  const w = state.result.winner;
  if (w === null) return { places: { 0: 1, 1: 1 }, draw: true, reason: state.result.reason };
  const whiteWins = w === 'w';
  return { places: { 0: whiteWins ? 1 : 2, 1: whiteWins ? 2 : 1 }, draw: false, reason: state.result.reason };
}

export class LocalDamesController implements GameController<DamesState, Move> {
  readonly kind = 'local' as const;
  readonly family = 'dames' as const;
  readonly id: string;
  readonly options: LocalDamesOptions;

  private state: DamesState;
  private moves: string[];
  private last: Move | null = null;
  private resigned: boolean;
  private readonly listeners = new Set<(s: DamesState, e?: GameEvent) => void>();
  private readonly cancel = { aborted: false };
  private thinking = false;
  private finished = false;
  private disposed = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    snapshot: LocalDamesSnapshot,
    private readonly deps: LocalDamesDeps,
  ) {
    this.options = snapshot.options;
    this.id = snapshot.options.id;
    const { state, played } = replayNotation(snapshot.options.variant, snapshot.moves);
    this.moves = [...snapshot.moves];
    this.last = played[played.length - 1] ?? null;
    this.resigned = snapshot.resigned;
    this.state = snapshot.resigned && !state.result ? resignState(state, 'w') : state;
    this.finished = this.state.result !== null;
  }

  /** Nouvelle partie (la machine joue tout de suite si c'est à elle). */
  static start(options: LocalDamesOptions, deps: LocalDamesDeps): LocalDamesController {
    const c = new LocalDamesController({ options, moves: [], resigned: false }, deps);
    c.persist();
    c.resume();
    return c;
  }

  /** Relance la machine si c'est à elle (après une reprise). */
  resume(): void {
    if (!this.state.result && this.state.turn === sideOfSeat(MACHINE_SEAT)) void this.machineTurn();
  }

  getState(): DamesState {
    return this.state;
  }

  /** Dernier coup joué (surbrillance), ou null. */
  lastMove(): Move | null {
    return this.last;
  }

  /** Coups joués (notation officielle). */
  history(): readonly string[] {
    return this.moves;
  }

  isThinking(): boolean {
    return this.thinking;
  }

  subscribe(cb: (s: DamesState, e?: GameEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  mySeats(): number[] {
    return [PLAYER_SEAT];
  }

  seats(): SeatInfo[] {
    const o = this.options;
    return [
      { seat: PLAYER_SEAT, userId: o.player.userId, name: o.player.name, ...(o.player.avatar !== undefined ? { avatar: o.player.avatar } : {}) },
      { seat: MACHINE_SEAT, userId: null, name: o.machineName, machine: { difficulty: o.difficulty } },
    ];
  }

  legalMoves(): Move[] {
    if (this.state.result || this.thinking || this.state.turn !== sideOfSeat(PLAYER_SEAT)) return [];
    return legalMoves(this.state);
  }

  play(move: Move): void {
    if (this.state.result || this.thinking || this.state.turn !== sideOfSeat(PLAYER_SEAT)) return;
    const legal = findLegal(this.state, { from: move.from, to: move.to, captures: move.captures });
    if (!legal) {
      this.emit({ kind: 'invalid', seat: PLAYER_SEAT });
      return;
    }
    this.apply(legal, PLAYER_SEAT);
    if (!this.state.result) void this.machineTurn();
  }

  resign(): void {
    if (this.state.result) return;
    this.cancel.aborted = true;
    this.thinking = false;
    this.resigned = true;
    this.state = resignState(this.state, 'w');
    this.persist();
    this.emit({ kind: 'end', seat: PLAYER_SEAT, params: { reason: 'resign' } });
    this.finish();
  }

  clock(): Record<number, SeatClock> | null {
    return null;
  }

  outcome(): GameOutcome | null {
    return outcomeOf(this.state);
  }

  /** Attend la fin des écritures (sauvegarde, historique) : avant de quitter l'écran. */
  whenSaved(): Promise<void> {
    return this.saving;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel.aborted = true;
    this.listeners.clear();
  }

  private apply(move: Move, seat: number): void {
    const before = this.state;
    this.state = applyMove(this.state, move);
    this.moves.push(toNotation(move));
    this.last = move;
    const promoted = before.board[move.from - 1] !== this.state.board[move.to - 1];
    this.persist();
    const kind = promoted ? 'promotion' : move.captures.length > 0 ? 'capture' : 'move';
    this.emit({ kind, seat, params: { from: move.from, to: move.to, path: move.path, captures: move.captures } });
    if (this.state.result) {
      this.emit({ kind: 'end', params: { reason: this.state.result.reason } });
      this.finish();
    } else if (seat === MACHINE_SEAT) {
      this.emit({ kind: 'turn', seat: PLAYER_SEAT });
    }
  }

  private async machineTurn(): Promise<void> {
    if (this.thinking || this.disposed) return;
    this.thinking = true;
    this.emit({ kind: 'thinking', seat: MACHINE_SEAT });
    const engine = this.deps.engine ?? chooseMove;
    const started = (this.deps.now ?? Date.now)();
    try {
      // Pas de limite de temps : la graine et les budgets de nœuds font le coup (rejeu serveur).
      const choice = await engine(this.state, { targetRating: this.options.machineRating, seed: this.options.seed, signal: this.cancel });
      const wait = (this.deps.machineDelayMs ?? 450) - ((this.deps.now ?? Date.now)() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (this.disposed || this.state.result) return;
      this.thinking = false;
      this.apply(choice.move, MACHINE_SEAT);
    } catch (err) {
      if (!(err instanceof SearchCancelledError)) throw err;
    } finally {
      this.thinking = false;
    }
  }

  private emit(event: GameEvent): void {
    for (const l of [...this.listeners]) l(this.state, event);
  }

  snapshot(): LocalDamesSnapshot {
    return { options: this.options, moves: [...this.moves], resigned: this.resigned };
  }

  private persist(): void {
    const data = this.state.result ? null : this.snapshot();
    this.saving = this.saving.then(() =>
      data ? writeJson(this.deps.storage, LOCAL_DAMES_KEY, data) : this.deps.storage.removeItem(LOCAL_DAMES_KEY),
    );
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const outcome = this.outcome();
    if (!outcome || !this.deps.onFinished) return;
    const record = this.toLocalGame(outcome);
    const done = this.deps.onFinished(record);
    this.saving = this.saving.then(() => done);
  }

  toLocalGame(outcome: GameOutcome): LocalGame {
    const o = this.options;
    return {
      id: o.id,
      family: 'dames',
      variant: o.variant,
      context: 'machine',
      seats: this.seats(),
      mySeats: [PLAYER_SEAT],
      // Abandon : la liste s'arrête là (le serveur en déduit l'abandon).
      moves: [...this.moves],
      outcome,
      machine: { difficulty: o.difficulty, mode: o.mode, bet: 0, offline: true, pending: true },
      playedAt: new Date((this.deps.now ?? Date.now)()).toISOString(),
    };
  }
}

/** Partie locale en cours gardée sur l'appareil (null si aucune ou illisible). */
export async function readLocalDames(storage: KeyValueStore): Promise<LocalDamesSnapshot | null> {
  const raw = (await readJson(storage, LOCAL_DAMES_KEY)) as LocalDamesSnapshot | null;
  if (!raw || typeof raw !== 'object' || !raw.options || !Array.isArray(raw.moves)) return null;
  try {
    replayNotation(raw.options.variant, raw.moves);
    return raw;
  } catch {
    return null;
  }
}

/** Graine 32 bits pour la machine (hasard de l'appareil ; jamais dans les paquets de règles). */
export function newSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0x1_0000_0000) >>> 0;
}
