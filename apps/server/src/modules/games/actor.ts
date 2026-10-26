/**
 * Acteur d'une partie en ligne (D-02) : une file d'événements, un seul écrivain, l'état en
 * mémoire. Chaque intention (coup, lancer, abandon, nulle, minuterie) passe par la file ;
 * elle est validée par @kwatt/rules-*, écrite en base, PUIS diffusée (`game.event`, puis
 * `game.state` avec un `seq` croissant).
 *
 * Temps :
 * - Dames : pendule Fischer tenue ici (temps restant par siège, incrément après chaque coup).
 *   Coupure d'un joueur : toutes les pendules s'arrêtent, il a 60 s pour revenir, sinon il
 *   perd (raison `absence`).
 * - Ludo : 30 s par action pour un humain ; temps écoulé → la machine joue ce tour à sa place.
 *   Coupé plus de 60 s → il sort (pions retirés, dernier, mise perdue). Rapide : fin au temps.
 * - Contre la machine : ni pendule ni absence (on reprend plus tard).
 *
 * L'horloge est celle du serveur (`Clock`) : les tests l'avancent et appellent `tick()`.
 */
import { commitment, createClientSeed, deriveCowries, deriveRoll } from '@kwatt/fair-dice';
import type { Level } from '@kwatt/ludo-ai';
import { cowrieValue, type LudoMove } from '@kwatt/rules-ludo';
import type { GameEventWire, GameStateMessage } from '@kwatt/protocol';
import { transaction, type Pool, type Transaction } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { RealtimeHub } from '../../realtime/hub.js';
import { DamesRules, DRAW_OFFER_EVERY_PLIES, LudoRules, ludoOptions, type GameRules, type Outcome } from './engine.js';
import type { MachinePlayer } from './machine.js';
import { insertMove, insertRoll, markSeatOut, writeEnd, type GameConfig, type LoadedGame } from './store.js';

/** Absence tolérée avant la défaite (Dames) ou la sortie (Ludo). */
export const ABSENCE_MS = 60_000;
/** Niveau de la machine qui joue le tour d'un joueur de Ludo trop lent. */
export const TAKEOVER_LEVEL: Level = 'moyen';

export const gameTopic = (gameId: string): string => `game:${gameId}`;

export interface ActorDeps {
  db: Pool;
  clock: Clock;
  log: Logger;
  hub: RealtimeHub;
  machine: MachinePlayer;
  /** Pause avant un coup de la machine (ms), pour qu'on la voie jouer ; 0 dans les tests. */
  machineDelayMs: number;
  /** Règlement de fin de partie, dans la même transaction que le résultat. */
  settle(tx: Transaction, actor: GameActor, outcome: Outcome): Promise<void>;
  /** Après validation : écouteurs (ligues, quartiers, quêtes, salons), anti-triche. */
  afterEnd(actor: GameActor, outcome: Outcome): Promise<void>;
  /** Réactions des spectateurs, montrées aux joueurs à la fin. */
  spectatorReactions(gameId: string): Promise<{ key: string; count: number }[]>;
}

interface Backup {
  state: unknown;
  extra: unknown;
}

export class GameActor {
  readonly id: string;
  readonly rules: GameRules;
  seq = 0;
  status: 'playing' | 'finished' | 'aborted' = 'playing';
  outcome: Outcome | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private idleWaiters: (() => void)[] = [];
  private readonly secret: Uint8Array | null;
  private nextRollIndex = 0;
  /** Index du lancer qui attend son coup (Ludo). */
  private pendingRollIndex: number | null = null;
  private lastRoll: { seat: number; value: number; shells?: boolean[] } | null = null;
  private lastMove: string | null = null;
  /** Dames : temps restant par siège, début du tour en cours, pendules arrêtées. */
  private remaining: number[] = [];
  private turnStart: number;
  private paused = false;
  /** Coupures en cours, par siège (ms) ; null : connecté. */
  private readonly disconnectedAt: (number | null)[];
  /** Ludo : la machine joue ce tour à la place de ce siège. */
  private takeover: { seat: number; turnNo: number } | null = null;
  private drawOffer: { seat: number } | null = null;
  private readonly lastOfferPly = new Map<number, number>();
  private thinking = false;
  private machineTimer: NodeJS.Timeout | null = null;
  private endReason: string | null = null;

  constructor(
    readonly config: GameConfig,
    private readonly deps: ActorDeps,
    loaded?: LoadedGame,
    secret?: Uint8Array | null,
  ) {
    this.id = config.id;
    this.secret = loaded?.secret ?? secret ?? null;
    const now = deps.clock.now().getTime();
    this.turnStart = now;
    this.disconnectedAt = config.seats.map(() => null);
    if (config.family === 'dames') {
      const moves = loaded ? loaded.moves.filter((m) => m.kind === 'move').map((m) => m.notation ?? '') : [];
      this.rules = DamesRules.replay(config.variant as 'dames10' | 'dames8', moves);
      const clock = config.rules.clock;
      if (clock) {
        this.remaining = config.seats.map(() => clock.initialMs);
        for (const m of loaded?.moves ?? []) if (m.clockMs !== null) this.remaining[m.seat] = m.clockMs;
      }
      this.lastMove = moves[moves.length - 1] ?? null;
    } else {
      const options = ludoOptions({ variant: config.variant, players: config.rules.players, teams: config.rules.teams, house: config.rules.house });
      const entries = (loaded?.moves ?? []).map((m) => m.notation ?? '');
      const used = new Set((loaded?.moves ?? []).map((m) => m.rollIndex).filter((x): x is number => x !== null));
      const rolls = loaded?.rolls ?? [];
      const last = rolls[rolls.length - 1];
      const pending = last && !used.has(last.rollIndex) ? last : null;
      this.rules = LudoRules.replay(options, entries, pending ? this.rollValue(pending.value) : null);
      this.nextRollIndex = rolls.length;
      this.pendingRollIndex = pending?.rollIndex ?? null;
      if (last) this.lastRoll = { seat: last.seat, value: this.rollValue(last.value) };
    }
    this.seq = loaded ? loaded.moves.length + (loaded.rolls.length ?? 0) : 0;
    if (loaded && loaded.status !== 'playing') {
      this.status = loaded.status === 'aborted' ? 'aborted' : 'finished';
      this.outcome = this.rules.outcome();
    }
    // Présence au départ : un joueur absent dès le début a lui aussi 60 s.
    if (config.rules.absence) {
      config.seats.forEach((s, i) => {
        if (s.userId && !deps.hub.isOnline(s.userId)) this.disconnectedAt[i] = now;
      });
      if (this.disconnectedAt.some((d) => d !== null)) this.paused = true;
    }
  }

  private get dames(): DamesRules | null {
    return this.rules instanceof DamesRules ? this.rules : null;
  }

  private get ludo(): LudoRules | null {
    return this.rules instanceof LudoRules ? this.rules : null;
  }

  private now(): number {
    return this.deps.clock.now().getTime();
  }

  private rollValue(stored: number): number {
    return this.ludo?.state.config.mechanics.throw === 'cowries' || ludoThrowOf(this.config) === 'cowries' ? cowrieValue(stored) : stored;
  }

  // ------------------------------------------------------------------
  // File d'événements
  // ------------------------------------------------------------------

  /** Exécute `fn` à son tour dans la file (un seul écrivain). */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    this.pending++;
    const run = this.queue.then(fn);
    this.queue = run.then(
      () => this.done(),
      () => this.done(),
    );
    return run;
  }

  private done(): void {
    this.pending--;
    if (this.pending === 0 && !this.machineTimer) for (const w of this.idleWaiters.splice(0)) w();
  }

  /** Attend que la file soit vide et que la machine ait fini de jouer (tests). */
  settled(): Promise<void> {
    if (this.pending === 0 && !this.machineTimer) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ------------------------------------------------------------------
  // Sièges
  // ------------------------------------------------------------------

  seatsOf(userId: string): number[] {
    return this.config.seats.filter((s) => s.userId === userId).map((s) => s.seat);
  }

  isPlayer(userId: string): boolean {
    return this.seatsOf(userId).length > 0;
  }

  private actingSeat(userId: string): number {
    if (this.status !== 'playing') throw new AppError('game.over', 409);
    const mine = this.seatsOf(userId);
    if (mine.length === 0) throw new AppError('game.not_a_player', 403);
    const turn = this.rules.turnSeat();
    if (turn === null || !mine.includes(turn)) throw new AppError('game.not_your_turn', 409);
    if (this.takeover && this.takeover.seat === turn) throw new AppError('game.not_your_turn', 409);
    return turn;
  }

  private isMachineSeat(seat: number): boolean {
    return this.config.seats[seat]?.userId === null;
  }

  private checkSeq(seq: number): void {
    if (seq !== this.seq) throw new AppError('game.stale', 409, { seq: this.seq });
  }

  // ------------------------------------------------------------------
  // Intentions des joueurs
  // ------------------------------------------------------------------

  move(userId: string, seq: number, text: string): Promise<void> {
    return this.enqueue(async () => {
      const seat = this.actingSeat(userId);
      this.checkSeq(seq);
      if (this.dames) await this.playDames(seat, text, 'human');
      else {
        const move = this.ludo!.findMove(text);
        if (!move) throw new AppError('game.illegal_move', 400, { move: text });
        await this.playLudo(seat, move, 'human');
      }
    });
  }

  roll(userId: string, seq: number, clientSeedHex: string): Promise<void> {
    return this.enqueue(async () => {
      const seat = this.actingSeat(userId);
      this.checkSeq(seq);
      if (!this.ludo || this.ludo.phase() !== 'roll') throw new AppError('game.roll_not_now', 409);
      await this.doRoll(seat, Buffer.from(clientSeedHex, 'hex'), 'human');
    });
  }

  resign(userId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.status !== 'playing') throw new AppError('game.over', 409);
      const seats = this.seatsOf(userId);
      if (seats.length === 0) throw new AppError('game.not_a_player', 403);
      if (this.dames) {
        this.dames.resign(seats[0]!);
        await this.end('resign');
      } else {
        for (const seat of seats) await this.quitLudo(seat, 'resign');
      }
    });
  }

  offerDraw(userId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.status !== 'playing') throw new AppError('game.over', 409);
      const d = this.dames;
      const seat = this.seatsOf(userId)[0];
      if (!d || seat === undefined) throw new AppError('game.not_a_player', 403);
      if (this.isMachineSeat(1 - seat)) throw new AppError('game.no_draw_offer', 409);
      const last = this.lastOfferPly.get(seat);
      if (last !== undefined && d.state.ply - last < DRAW_OFFER_EVERY_PLIES) {
        throw new AppError('game.draw_too_soon', 409, { afterPly: last + DRAW_OFFER_EVERY_PLIES });
      }
      this.lastOfferPly.set(seat, d.state.ply);
      this.drawOffer = { seat };
      this.publish({ kind: 'draw_offer', seat });
    });
  }

  answerDraw(userId: string, accept: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (this.status !== 'playing') throw new AppError('game.over', 409);
      const seat = this.seatsOf(userId)[0];
      if (!this.dames || seat === undefined || !this.drawOffer || this.drawOffer.seat === seat) throw new AppError('game.no_draw_offer', 409);
      this.drawOffer = null;
      if (!accept) {
        this.publish({ kind: 'draw_declined', seat });
        return;
      }
      this.dames.agreeDraw();
      await this.end('agreement');
    });
  }

  /** Réaction d'un joueur : montrée tout de suite aux autres (pas d'écriture). */
  react(userId: string, key: string): void {
    const seat = this.seatsOf(userId)[0];
    if (seat === undefined) return;
    this.deps.hub.publish(gameTopic(this.id), { t: 'game.event', gameId: this.id, seq: this.seq, event: { kind: 'reaction', seat, params: { key } } });
  }

  // ------------------------------------------------------------------
  // Coups, lancers, sorties (écriture puis diffusion)
  // ------------------------------------------------------------------

  private backup(): Backup {
    const r = this.rules;
    return {
      state: r instanceof DamesRules ? { s: r.state, m: [...r.moves] } : { s: r.state, log: { moves: [...r.moves], pendingRoll: r.pendingRoll } },
      extra: {
        remaining: [...this.remaining],
        turnStart: this.turnStart,
        lastRoll: this.lastRoll,
        lastMove: this.lastMove,
        pendingRollIndex: this.pendingRollIndex,
        nextRollIndex: this.nextRollIndex,
      },
    };
  }

  private restore(b: Backup): void {
    const r = this.rules;
    if (r instanceof DamesRules) {
      const s = b.state as { s: DamesRules['state']; m: string[] };
      r.state = s.s;
      r.moves.splice(0, r.moves.length, ...s.m);
    } else {
      const s = b.state as { s: LudoRules['state']; log: { moves: string[]; pendingRoll: number | null } };
      const fresh = LudoRules.replay(r.options, s.log.moves, s.log.pendingRoll);
      r.state = fresh.state;
      Object.assign(r, { log: { moves: s.log.moves, pendingRoll: s.log.pendingRoll } });
    }
    Object.assign(this, b.extra);
  }

  /** Écrit (fn) puis, seulement si l'écriture réussit, rend la main ; sinon remet l'état. */
  private async write(backup: Backup, fn: (tx: Transaction) => Promise<void>): Promise<void> {
    try {
      await transaction(this.deps.db, fn);
    } catch (err) {
      this.restore(backup);
      throw err;
    }
  }

  private damesElapsed(now: number): number {
    return this.paused ? 0 : Math.max(0, now - this.turnStart);
  }

  private async playDames(seat: number, text: string, by: 'human' | 'ai'): Promise<void> {
    const d = this.dames!;
    const backup = this.backup();
    const now = this.now();
    const ply = d.moves.length;
    const played = d.play(seat, text);
    if (!played) throw new AppError('game.illegal_move', 400, { move: text });
    const { notation, move } = played;
    let clockMs: number | null = null;
    const clock = this.config.rules.clock;
    if (clock) {
      clockMs = Math.max(0, (this.remaining[seat] ?? 0) - this.damesElapsed(now) + clock.incrementMs);
      this.remaining[seat] = clockMs;
      this.turnStart = now;
    }
    this.lastMove = notation;
    await this.write(backup, (tx) =>
      insertMove(tx, this.id, { ply, turnNo: Math.floor(ply / 2) + 1, seat, kind: 'move', rollIndex: null, notation, clockMs, playedBy: by, state: d.state }, new Date(now)),
    );
    // Une proposition de nulle tombe quand l'autre joue.
    if (this.drawOffer && this.drawOffer.seat !== seat) this.drawOffer = null;
    this.publish({
      kind: move.captures.length > 0 ? 'capture' : 'move',
      seat,
      params: { notation, from: move.from, to: move.to, path: move.path, captures: move.captures },
    });
    if (d.over()) await this.end();
    else this.scheduleMachine();
  }

  private async doRoll(seat: number, clientSeed: Buffer, by: 'human' | 'ai'): Promise<void> {
    const l = this.ludo!;
    if (!this.secret) throw new AppError('game.roll_not_now', 409);
    const backup = this.backup();
    const now = this.now();
    const rollIndex = this.nextRollIndex;
    const input = { serverSeed: this.secret, gameId: this.id, rollIndex, clientSeed: new Uint8Array(clientSeed) };
    const cowries = l.state.config.mechanics.throw === 'cowries';
    const throwRes = cowries ? deriveCowries(input) : null;
    const stored = throwRes ? throwRes.up : deriveRoll(input);
    const value = throwRes ? cowrieValue(throwRes.up) : stored;
    const ply = l.moves.length;
    const turnNo = l.state.turnNo;
    const res = l.roll(value);
    this.nextRollIndex = rollIndex + 1;
    this.pendingRollIndex = res.passed ? null : rollIndex;
    this.lastRoll = { seat, value, ...(throwRes ? { shells: throwRes.shells } : {}) };
    this.turnStart = now;
    await this.write(backup, async (tx) => {
      await insertRoll(tx, this.id, { rollIndex, seat, clientSeed, value: stored }, new Date(now));
      if (res.passed) {
        await insertMove(tx, this.id, { ply, turnNo, seat, kind: 'pass', rollIndex, notation: l.moves[ply]!, clockMs: null, playedBy: by, state: l.state }, new Date(now));
      }
    });
    this.publish({ kind: value === 6 ? 'six' : 'roll', seat, params: { value, ...(throwRes ? { shells: throwRes.shells } : {}), passed: res.passed } });
    if (l.over()) await this.end();
    else this.scheduleMachine();
  }

  private async playLudo(seat: number, move: LudoMove, by: 'human' | 'ai' | 'auto'): Promise<void> {
    const l = this.ludo!;
    const backup = this.backup();
    const now = this.now();
    const ply = l.moves.length;
    const turnNo = l.state.turnNo;
    const rollIndex = l.pendingRoll === null ? null : this.pendingRollIndex;
    const homeBefore = l.tokensHome()[move.seat] ?? 0;
    const notation = l.play(move);
    this.pendingRollIndex = null;
    this.turnStart = now;
    await this.write(backup, (tx) =>
      insertMove(tx, this.id, { ply, turnNo, seat, kind: 'move', rollIndex, notation, clockMs: null, playedBy: by, state: l.state }, new Date(now)),
    );
    const home = (l.tokensHome()[move.seat] ?? 0) > homeBefore;
    const kind = move.captures.length > 0 ? 'capture' : home ? 'home' : move.from < 0 ? 'enter' : 'move';
    this.publish({ kind, seat, params: { seat: move.seat, token: move.token, from: move.from, to: move.to, captures: move.captures, notation } });
    if (l.over()) await this.end();
    else this.scheduleMachine();
  }

  private async quitLudo(seat: number, reason: 'resign' | 'absence'): Promise<void> {
    const l = this.ludo!;
    const backup = this.backup();
    const now = this.now();
    const ply = l.moves.length;
    const turnNo = l.state.turnNo;
    const notation = l.quit(seat);
    if (!notation) return;
    if (this.takeover?.seat === seat) this.takeover = null;
    this.pendingRollIndex = l.pendingRoll === null ? null : this.pendingRollIndex;
    this.turnStart = now;
    await this.write(backup, async (tx) => {
      await insertMove(tx, this.id, { ply, turnNo, seat, kind: reason === 'resign' ? 'resign' : 'timeout', rollIndex: null, notation, clockMs: null, playedBy: 'auto', state: l.state }, new Date(now));
      await markSeatOut(tx, this.id, seat, new Date(now));
    });
    this.publish({ kind: 'out', seat, params: { reason } });
    if (l.over()) await this.end(reason === 'resign' ? 'resign' : 'absence');
    else this.scheduleMachine();
  }

  // ------------------------------------------------------------------
  // Machine
  // ------------------------------------------------------------------

  private machineSeatToAct(): number | null {
    if (this.status !== 'playing') return null;
    const seat = this.rules.turnSeat();
    if (seat === null) return null;
    if (this.isMachineSeat(seat)) return seat;
    const l = this.ludo;
    if (l && this.takeover && this.takeover.seat === seat && this.takeover.turnNo === l.state.turnNo) return seat;
    if (this.takeover && (this.takeover.seat !== seat || (l && this.takeover.turnNo !== l.state.turnNo))) this.takeover = null;
    return null;
  }

  private scheduleMachine(): void {
    if (this.machineTimer) return;
    const seat = this.machineSeatToAct();
    if (seat === null) {
      this.thinking = false;
      return;
    }
    this.thinking = true;
    this.machineTimer = setTimeout(() => {
      this.machineTimer = null;
      void this.enqueue(() => this.machineStep()).catch((err: unknown) => this.deps.log.error({ err, gameId: this.id }, 'coup de la machine en échec'));
    }, this.deps.machineDelayMs);
    this.machineTimer.unref?.();
  }

  private async machineStep(): Promise<void> {
    const seat = this.machineSeatToAct();
    if (seat === null) {
      this.thinking = false;
      return;
    }
    const by = 'ai' as const;
    if (this.dames) {
      const m = this.config.rules.machine;
      const notation = await this.deps.machine.dames(this.dames.state, { targetRating: m?.machineRating ?? null, seed: m?.seed ?? 1 });
      this.thinking = false;
      await this.playDames(seat, notation, by);
      return;
    }
    const l = this.ludo!;
    if (l.phase() === 'roll') {
      await this.doRoll(seat, Buffer.from(createClientSeed()), by);
      return;
    }
    const level: Level = this.isMachineSeat(seat) ? ((this.config.rules.machine?.difficulty as Level | undefined) ?? 'moyen') : TAKEOVER_LEVEL;
    const choice = await this.deps.machine.ludo(l.state, { level, seed: (this.config.rules.machine?.seed ?? 7) ^ l.moves.length });
    const legal = l.choices().find((c) => c.seat === choice.seat && c.token === choice.token) ?? l.choices()[0];
    this.thinking = false;
    if (legal) await this.playLudo(seat, legal, this.isMachineSeat(seat) ? 'ai' : 'auto');
  }

  // ------------------------------------------------------------------
  // Minuteries et présence
  // ------------------------------------------------------------------

  /** Pendules, temps par tour, absences, fin au temps du Rapide. Appelé chaque seconde. */
  tick(): Promise<void> {
    if (this.status !== 'playing') return Promise.resolve();
    return this.enqueue(async () => {
      if (this.status !== 'playing') return;
      const now = this.now();
      // Absences de plus de 60 s.
      if (this.config.rules.absence) {
        for (const [seat, at] of this.disconnectedAt.entries()) {
          if (at === null || now - at < ABSENCE_MS || this.status !== 'playing') continue;
          this.disconnectedAt[seat] = null;
          if (this.dames) {
            this.dames.resign(seat);
            await this.end('absence');
            return;
          }
          if (!this.ludo!.isOut(seat)) await this.quitLudo(seat, 'absence');
        }
        if (this.status !== 'playing') return;
        this.updatePause(now);
      }
      const d = this.dames;
      if (d && this.config.rules.clock && !this.paused) {
        const seat = d.turnSeat();
        if (seat !== null && (this.remaining[seat] ?? 0) - this.damesElapsed(now) <= 0) {
          this.remaining[seat] = 0;
          d.timeout(seat);
          await this.end('timeout');
          return;
        }
      }
      const l = this.ludo;
      if (l) {
        const limit = l.timeLimitMs();
        if (limit !== null && now - this.config.startedAt.getTime() >= limit) {
          l.endOnTime();
          await this.end('time');
          return;
        }
        const seat = l.turnSeat();
        const turnMs = this.config.rules.turnMs;
        if (seat !== null && turnMs !== null && !this.isMachineSeat(seat) && !this.takeover && now - this.turnStart >= turnMs) {
          this.takeover = { seat, turnNo: l.state.turnNo };
          this.publish({ kind: 'takeover', seat });
          this.scheduleMachine();
        }
      }
    });
  }

  /** Un joueur se connecte ou se coupe (présence du temps réel). */
  presence(userId: string, online: boolean): Promise<void> {
    if (this.status !== 'playing' || !this.config.rules.absence) return Promise.resolve();
    return this.enqueue(async () => {
      const now = this.now();
      let changed = false;
      for (const seat of this.seatsOf(userId)) {
        const was = this.disconnectedAt[seat] ?? null;
        if (online && was !== null) {
          this.disconnectedAt[seat] = null;
          changed = true;
        } else if (!online && was === null) {
          this.disconnectedAt[seat] = now;
          changed = true;
        }
      }
      if (!changed) return;
      this.updatePause(now);
      this.publish({ kind: online ? 'reconnected' : 'disconnected', seat: this.seatsOf(userId)[0] ?? 0 });
    });
  }

  private updatePause(now: number): void {
    const shouldPause = this.disconnectedAt.some((d) => d !== null);
    if (shouldPause === this.paused) return;
    const d = this.dames;
    if (shouldPause) {
      const seat = d?.turnSeat();
      if (d && seat !== null && seat !== undefined && this.config.rules.clock) this.remaining[seat] = Math.max(0, (this.remaining[seat] ?? 0) - (now - this.turnStart));
      this.paused = true;
    } else {
      this.paused = false;
      this.turnStart = now;
    }
  }

  /** Démarrage (ou reprise) : la machine joue si c'est à elle. */
  start(): Promise<void> {
    return this.enqueue(async () => this.scheduleMachine());
  }

  /** Reprise après redémarrage : le temps d'arrêt du serveur n'est pas décompté. */
  resumeClocks(): void {
    this.turnStart = this.now();
  }

  // ------------------------------------------------------------------
  // Fin de partie
  // ------------------------------------------------------------------

  private async end(reason?: string): Promise<void> {
    if (this.status !== 'playing') return;
    this.endReason = reason ?? null;
    const outcome = this.dames ? this.dames.outcome(reason) : this.ludo!.outcome(reason);
    if (!outcome) return;
    if (this.machineTimer) {
      clearTimeout(this.machineTimer);
      this.machineTimer = null;
    }
    const now = this.deps.clock.now();
    await transaction(this.deps.db, async (tx) => {
      await writeEnd(tx, this.id, outcome, 'finished', now);
      await this.deps.settle(tx, this, outcome);
    });
    this.status = 'finished';
    this.outcome = outcome;
    this.thinking = false;
    this.drawOffer = null;
    this.publish({ kind: 'end', params: { reason: outcome.reason } });
    const reactions = await this.deps.spectatorReactions(this.id).catch(() => []);
    this.deps.hub.publish(gameTopic(this.id), { t: 'game.end', gameId: this.id, outcome: wireOutcome(outcome), reactions });
    try {
      await this.deps.afterEnd(this, outcome);
    } catch (err) {
      this.deps.log.error({ err, gameId: this.id }, 'suites de fin de partie en échec');
    }
  }

  /** Arrête les minuteries (fermeture du serveur). */
  dispose(): void {
    if (this.machineTimer) clearTimeout(this.machineTimer);
    this.machineTimer = null;
    for (const w of this.idleWaiters.splice(0)) w();
  }

  // ------------------------------------------------------------------
  // Diffusion
  // ------------------------------------------------------------------

  /** Nouvel état : un `game.event` (animation), puis `game.state` à chaque abonné. */
  private publish(event: GameEventWire): void {
    this.seq++;
    const topic = gameTopic(this.id);
    this.deps.hub.publish(topic, { t: 'game.event', gameId: this.id, seq: this.seq, event });
    for (const conn of this.deps.hub.subscribers(topic)) this.deps.hub.send(conn, this.stateFor(conn.userId));
  }

  spectatorCount(): number {
    const players = new Set(this.config.seats.map((s) => s.userId).filter(Boolean));
    return new Set(this.deps.hub.subscribers(gameTopic(this.id)).map((c) => c.userId).filter((u) => !players.has(u))).size;
  }

  clocks(now = this.now()): Record<string, { remainingMs: number; running: boolean }> | null {
    const d = this.dames;
    if (!d || !this.config.rules.clock) return null;
    const turn = this.status === 'playing' ? d.turnSeat() : null;
    return Object.fromEntries(
      this.config.seats.map((s) => {
        const running = turn === s.seat && !this.paused;
        const left = (this.remaining[s.seat] ?? 0) - (running ? now - this.turnStart : 0);
        return [String(s.seat), { remainingMs: Math.max(0, Math.round(left)), running }];
      }),
    );
  }

  turnDeadline(): number | null {
    const l = this.ludo;
    const turnMs = this.config.rules.turnMs;
    if (!l || turnMs === null || this.status !== 'playing') return null;
    const seat = l.turnSeat();
    if (seat === null || this.isMachineSeat(seat) || this.takeover) return null;
    return this.turnStart + turnMs;
  }

  stateFor(userId: string | null): GameStateMessage {
    const outcome = this.outcome;
    return {
      t: 'game.state',
      gameId: this.id,
      seq: this.seq,
      family: this.config.family,
      variant: this.config.variant,
      status: this.status,
      state: this.rules.state,
      moves: [...this.rules.moves],
      clocks: this.clocks(),
      seats: this.config.seats.map((s) => ({
        seat: s.seat,
        userId: s.userId,
        pseudo: s.name,
        ...(s.machine ? { machine: s.machine } : {}),
        ...(s.team !== undefined ? { team: s.team } : {}),
        connected: s.userId === null ? true : this.deps.hub.isOnline(s.userId),
        ...(this.ludo ? { out: this.ludo.isOut(s.seat) } : {}),
      })),
      mySeats: userId ? this.seatsOf(userId) : [],
      turnDeadline: this.turnDeadline(),
      lastRoll: this.lastRoll,
      lastMove: this.lastMove,
      drawOffer: this.drawOffer,
      thinking: this.thinking,
      outcome: outcome ? wireOutcome(outcome) : null,
      diceCommitment: this.secret ? commitment(this.secret) : null,
      spectators: this.spectatorCount(),
      serverTime: this.now(),
    };
  }

  // Lecture pour les vues et le règlement.
  pieceDiff(): number | undefined {
    return this.dames?.pieceDiff();
  }

  tokensHome(): Record<string, number> | undefined {
    const t = this.ludo?.tokensHome();
    return t ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v])) : undefined;
  }

  winners(): number[] {
    if (this.dames) {
      const o = this.outcome ?? this.dames.outcome();
      if (!o || o.draw) return [];
      return Object.entries(o.places)
        .filter(([, p]) => p === 1)
        .map(([s]) => Number(s));
    }
    return this.ludo!.winners();
  }

  progress(): number {
    return this.rules.progress();
  }

  get reason(): string | null {
    return this.endReason;
  }
}

export function wireOutcome(o: Outcome): { places: Record<string, number>; draw: boolean; reason: string } {
  return { places: Object.fromEntries(Object.entries(o.places).map(([k, v]) => [k, v])), draw: o.draw, reason: o.reason };
}

function ludoThrowOf(config: GameConfig): 'dice' | 'cowries' {
  return config.variant === 'ludo_pachisi' ? 'cowries' : 'dice';
}
