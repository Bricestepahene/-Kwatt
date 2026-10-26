/**
 * Partie de Ludo locale contre 1 à 3 machines (hors connexion, écrans 21, 21b, 21c) :
 * contrôleur `local` du contrat commun (SPEC §9).
 *
 * - Règles : @kwatt/rules-ludo ; machine : @kwatt/ludo-ai (`chooseMove`, niveau = difficulté) ;
 *   lancers tirés sur l'appareil (crypto.getRandomValues), jamais de pari hors ligne.
 * - Le joueur est au siège 0, les machines aux sièges suivants ; au Pachisi, équipes
 *   [0, 2] contre [1, 3] (ton partenaire est une machine).
 * - Chaque lancer et chaque coup est noté au format du contrat C2 (« 6:2 », « 3:- », « b:0 »),
 *   et la partie est sauvegardée après chaque pas : on la reprend en rejouant sa notation.
 * - À la fin : `onFinished(partie)` (historique local C4, envoi du résultat C2).
 *
 * Module sans React Native : horloge, minuteries, hasard, stockage et machine sont injectés.
 */
import { hashNumbers, chooseMove as aiChooseMove, type Level } from '@kwatt/ludo-ai';
import {
  applyMove,
  applyRoll,
  distinctMoves,
  endOnTime,
  finish as finishProgress,
  legalMoves,
  recordMove,
  recordQuit,
  recordRoll,
  removeSeat,
  replayNotation,
  teamOf,
  type LudoMove,
  type LudoState,
  type NotationLog,
} from '@kwatt/rules-ludo';
import { readJson, writeJson, type KeyValueStore } from '../../../storage/kv';
import type { GameController, GameEvent, GameOutcome, SeatClock, SeatInfo } from '../../game/controller';
import type { LocalGame } from '../../game/historyStore';
import { gameOptions, variantId, type LudoSetup } from '../setup';
import type { ThrowResult } from './dice';

export const LOCAL_LUDO_KEY = 'kwatt.ludo.local.v1';
export const PLAYER_SEAT = 0;

export interface LocalLudoOptions {
  id: string;
  setup: Pick<LudoSetup, 'preset' | 'house'>;
  machines: number;
  difficulty: Level;
  mode: 'auto' | 'chosen';
  /** Graine de la machine (envoyée au serveur avec le résultat). */
  seed: number;
  /** Noms affichés par siège (le joueur, puis les machines), traduits à la création. */
  names: string[];
  /** Envoyer le résultat au serveur (profil, partie sans règles maison). */
  submit: boolean;
  createdAt: number;
}

export interface LocalLudoSnapshot {
  version: 1;
  options: LocalLudoOptions;
  moves: string[];
  pendingRoll: number | null;
  /** Temps de jeu écoulé (ms), pour la fin au temps du Rapide. */
  elapsedMs: number;
  /** Abandon du joueur (la partie est alors finie). */
  resigned?: boolean;
}

export interface LocalLudoDeps {
  storage: KeyValueStore;
  /** Tire un lancer (dé ou cauris). */
  throwDice: (kind: LudoState['config']['mechanics']['throw']) => ThrowResult;
  now: () => number;
  schedule: (fn: () => void, ms: number) => () => void;
  /** Coup unique joué tout seul (préférence, vrai par défaut). */
  autoPlaySingleMove: () => boolean;
  /** Pauses de la machine (selon l'animation du dé). */
  delays: () => { roll: number; move: number; auto: number };
  /** Choix de la machine ; par défaut @kwatt/ludo-ai au niveau de la difficulté. */
  chooseMove?: (state: LudoState, level: Level, seed: number) => LudoMove;
  onFinished?: (game: LocalGame) => void;
}

/** Événements émis (sons, animations, messages de l'écran). */
export type LudoEventKind = 'roll' | 'move' | 'turn' | 'end';

function defaultChoose(state: LudoState, level: Level, seed: number): LudoMove {
  return aiChooseMove({ state, level, seed }).move;
}

export class LocalLudoController implements GameController<LudoState, LudoMove> {
  readonly kind = 'local' as const;
  readonly family = 'ludo' as const;
  readonly id: string;

  private state: LudoState;
  private log: NotationLog;
  private readonly listeners = new Set<(s: LudoState, e?: GameEvent) => void>();
  private cancel: (() => void) | null = null;
  private timeCheck: (() => void) | null = null;
  private elapsedBefore: number;
  private resumedAt: number;
  private resigned: boolean;
  private finished = false;
  private disposed = false;
  /** Dernier lancer (y compris un lancer sans coup), pour l'affichage. */
  private lastThrow: { seat: number; value: number; shells?: boolean[] } | null = null;

  constructor(
    readonly options: LocalLudoOptions,
    private readonly deps: LocalLudoDeps,
    snapshot?: Pick<LocalLudoSnapshot, 'moves' | 'pendingRoll' | 'elapsedMs' | 'resigned'>,
  ) {
    this.id = options.id;
    const setup = gameOptions(options.setup, options.machines);
    this.log = { moves: [...(snapshot?.moves ?? [])], pendingRoll: snapshot?.pendingRoll ?? null };
    this.state = replayNotation(setup, this.log.moves, this.log.pendingRoll);
    this.elapsedBefore = snapshot?.elapsedMs ?? 0;
    this.resumedAt = deps.now();
    this.resigned = snapshot?.resigned ?? false;
    if (this.resigned) this.state = endOnTime(removeSeat(this.state, PLAYER_SEAT));
    if (this.state.roll !== null && this.log.pendingRoll !== null) this.lastThrow = { seat: this.state.current, value: this.state.roll };
  }

  /** Lance la partie (ou la reprend) : la machine joue si c'est à elle. */
  start(): void {
    this.checkTime();
    this.advance();
  }

  getState(): LudoState {
    return this.state;
  }

  /** Notation de la partie jusqu'ici (format C2). */
  moves(): string[] {
    return [...this.log.moves];
  }

  /** Dernier lancer affiché (valeur et coquillages). */
  lastRoll(): { seat: number; value: number; shells?: boolean[] } | null {
    return this.lastThrow;
  }

  subscribe(cb: (state: LudoState, event?: GameEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  mySeats(): number[] {
    return [PLAYER_SEAT];
  }

  seats(): SeatInfo[] {
    return this.state.seats.map((_, seat) => {
      const team = this.state.config.teams.length > 0 ? teamOf(this.state, seat) : undefined;
      const base: SeatInfo = {
        seat,
        userId: null,
        name: this.options.names[seat] ?? '',
        ...(team !== undefined ? { team } : {}),
      };
      return seat === PLAYER_SEAT ? base : { ...base, machine: { difficulty: this.options.difficulty } };
    });
  }

  legalMoves(): LudoMove[] {
    if (this.finished || this.state.phase !== 'move' || this.state.current !== PLAYER_SEAT || this.cancel) return [];
    return legalMoves(this.state);
  }

  /** À toi de lancer ? */
  canRoll(): boolean {
    return !this.finished && !this.cancel && this.state.phase === 'roll' && this.state.current === PLAYER_SEAT;
  }

  roll(): void {
    if (!this.canRoll()) return;
    this.doRoll();
  }

  play(move: LudoMove): void {
    const legal = this.legalMoves().find((m) => m.seat === move.seat && m.token === move.token);
    if (!legal) return;
    this.doMove(legal, false);
  }

  resign(): void {
    if (this.finished) return;
    this.clearTimers();
    this.resigned = true;
    // « x:0 » dans la notation : le serveur compte l'abandon (sinon une partie Rapide serait finie au temps).
    this.log = recordQuit(this.log, PLAYER_SEAT);
    this.state = endOnTime(removeSeat(this.state, PLAYER_SEAT));
    this.emit({ kind: 'end', params: { reason: 'resign' } });
    this.persist();
    this.finish();
  }

  clock(): Record<number, SeatClock> | null {
    return null;
  }

  /** Rapide : temps restant (ms) avant la fin au temps, sinon null. */
  timeLeftMs(): number | null {
    const limit = this.state.config.timeLimitMs;
    if (limit === null) return null;
    return Math.max(0, limit - this.elapsed());
  }

  outcome(): GameOutcome | null {
    if (this.state.phase !== 'over') return null;
    const places: Record<number, number> = {};
    this.state.ranking.forEach((seat, i) => {
      places[seat] = i + 1;
    });
    this.state.seats.forEach((_, seat) => {
      places[seat] ??= this.state.seats.length;
    });
    const reason = this.resigned ? 'resign' : this.state.config.timeLimitMs !== null && this.state.seats.some((s) => s.status === 'playing') ? 'time' : 'all_home';
    return { places, draw: false, reason };
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.persistElapsed();
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------

  private elapsed(): number {
    return this.elapsedBefore + (this.disposed ? 0 : this.deps.now() - this.resumedAt);
  }

  private clearTimers(): void {
    this.cancel?.();
    this.cancel = null;
    this.timeCheck?.();
    this.timeCheck = null;
  }

  private emit(event?: GameEvent): void {
    for (const cb of [...this.listeners]) cb(this.state, event);
  }

  private doRoll(): void {
    const before = this.state;
    const t = this.deps.throwDice(before.config.mechanics.throw);
    const after = applyRoll(before, t.value);
    this.log = recordRoll(this.log, after, t.value);
    this.state = after;
    this.lastThrow = { seat: before.current, value: t.value, ...(t.shells ? { shells: t.shells } : {}) };
    const playable = after.phase === 'move' ? distinctMoves(legalMoves(after)).length : 0;
    this.emit({ kind: 'roll', seat: before.current, params: { value: t.value, playable, ...(t.shells ? { shells: t.shells } : {}) } });
    this.persist();
    this.afterStep(before.current);
  }

  private doMove(move: LudoMove, auto: boolean): void {
    const before = this.state;
    this.log = recordMove(this.log, before, move);
    this.state = applyMove(before, { seat: move.seat, token: move.token });
    const home = move.to === finishProgress(before.config);
    this.emit({
      kind: 'move',
      seat: before.current,
      params: { token: move.token, owner: move.seat, from: move.from, to: move.to, captures: move.captures.length, home, auto, bonus: before.bonus.length > 0 },
    });
    this.persist();
    this.afterStep(before.current);
  }

  /** Après un lancer ou un coup : fin, changement de tour, coup unique automatique, machine. */
  private afterStep(previous: number): void {
    this.checkTime();
    if (this.state.phase === 'over') {
      this.emit({ kind: 'end', params: { reason: this.outcome()?.reason ?? 'all_home' } });
      this.finish();
      return;
    }
    if (this.state.current !== previous) this.emit({ kind: 'turn', seat: this.state.current });
    this.advance();
  }

  /** Programme la suite : machine au trait, ou coup unique du joueur joué tout seul. */
  private advance(): void {
    if (this.finished || this.disposed || this.state.phase === 'over') {
      if (this.state.phase === 'over' && !this.finished) this.finish();
      return;
    }
    this.cancel?.();
    this.cancel = null;
    const d = this.deps.delays();
    if (this.state.current !== PLAYER_SEAT) {
      const ms = this.state.phase === 'roll' ? d.roll : d.move;
      this.cancel = this.deps.schedule(() => {
        this.cancel = null;
        this.machineStep();
      }, ms);
      return;
    }
    if (this.state.phase === 'move' && this.deps.autoPlaySingleMove()) {
      const moves = distinctMoves(legalMoves(this.state));
      if (moves.length === 1) {
        const only = moves[0]!;
        this.cancel = this.deps.schedule(() => {
          this.cancel = null;
          this.doMove(only, true);
        }, d.auto);
      }
    }
    this.scheduleTimeCheck();
  }

  private machineStep(): void {
    if (this.finished || this.disposed) return;
    if (this.state.phase === 'roll') {
      this.doRoll();
      return;
    }
    const moves = legalMoves(this.state);
    if (moves.length === 0) return;
    const choose = this.deps.chooseMove ?? defaultChoose;
    const seed = hashNumbers([this.options.seed, this.log.moves.length]);
    let move: LudoMove;
    try {
      move = choose(this.state, this.options.difficulty, seed);
    } catch {
      move = moves[0]!;
    }
    const legal = moves.find((m) => m.seat === move.seat && m.token === move.token) ?? moves[0]!;
    this.doMove(legal, false);
  }

  /** Rapide : la partie s'arrête au bout de 10 minutes de jeu, classement à la progression. */
  private checkTime(): void {
    const left = this.timeLeftMs();
    if (left === null || left > 0 || this.state.phase === 'over') return;
    this.clearTimers();
    this.state = endOnTime(this.state);
    this.emit({ kind: 'end', params: { reason: 'time' } });
    this.persist();
    this.finish();
  }

  private scheduleTimeCheck(): void {
    const left = this.timeLeftMs();
    if (left === null) return;
    this.timeCheck?.();
    this.timeCheck = this.deps.schedule(() => {
      this.timeCheck = null;
      this.checkTime();
    }, left + 50);
  }

  private snapshot(): LocalLudoSnapshot {
    return {
      version: 1,
      options: this.options,
      moves: this.log.moves,
      pendingRoll: this.log.pendingRoll,
      elapsedMs: this.elapsed(),
      ...(this.resigned ? { resigned: true } : {}),
    };
  }

  private persist(): void {
    void writeJson(this.deps.storage, LOCAL_LUDO_KEY, this.snapshot()).catch(() => undefined);
  }

  private persistElapsed(): void {
    if (this.finished) return;
    this.elapsedBefore = this.elapsed();
    this.resumedAt = this.deps.now();
    this.persist();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    void this.deps.storage.removeItem(LOCAL_LUDO_KEY).catch(() => undefined);
    const outcome = this.outcome();
    if (!outcome) return;
    this.deps.onFinished?.(this.toLocalGame(outcome));
  }

  /** Partie terminée, au format de l'historique local (C4). */
  toLocalGame(outcome: GameOutcome): LocalGame {
    const o = this.options;
    return {
      id: o.id,
      family: 'ludo',
      variant: variantId(o.setup.preset),
      context: 'machine',
      seats: this.seats(),
      mySeats: [PLAYER_SEAT],
      moves: [...this.log.moves],
      ...(o.setup.house ? { house: o.setup.house } : {}),
      outcome,
      machine: { difficulty: o.difficulty, mode: o.mode, bet: 0, offline: true, pending: o.submit },
      playedAt: new Date(o.createdAt).toISOString(),
    };
  }
}

/** Lit la partie locale sauvegardée (une seule à la fois), ou null. */
export async function readLocalLudo(storage: KeyValueStore): Promise<LocalLudoSnapshot | null> {
  const raw = (await readJson(storage, LOCAL_LUDO_KEY)) as Partial<LocalLudoSnapshot> | null;
  if (!raw || raw.version !== 1 || !raw.options || !Array.isArray(raw.moves)) return null;
  return {
    version: 1,
    options: raw.options,
    moves: raw.moves.filter((m): m is string => typeof m === 'string'),
    pendingRoll: typeof raw.pendingRoll === 'number' ? raw.pendingRoll : null,
    elapsedMs: typeof raw.elapsedMs === 'number' ? raw.elapsedMs : 0,
    ...(raw.resigned ? { resigned: true } : {}),
  };
}

/** Graine de la machine : entier 32 bits non signé. */
export function newSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0xffff_ffff) >>> 0;
}
