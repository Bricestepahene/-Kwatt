/**
 * Service des parties en ligne (contrat C3) : registre des acteurs en mémoire, création des
 * parties (salons, défis, ligues, machine en ligne), reprise au redémarrage, minuterie,
 * règlement de fin de partie (force, mises, pari contre la machine, pronostics), et
 * l'événement `onGameFinished` pour les autres modules (ligues, quartiers, quêtes, salons).
 */
import { agreementRate } from '@kwatt/engine-dames';
import { isRatedVariant, validateMachineBet } from '@kwatt/domain';
import type { CreateMachineGameRequest } from '@kwatt/protocol';
import { transaction, type Pool, type Transaction } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { RealtimeHub } from '../../realtime/hub.js';
import { lockStake, lockStakes, payoutPot, refundStakes } from '../economy/escrow.js';
import { balanceOf } from '../economy/ledger.js';
import { assertVariant, machineOffers, settleMachineOnline } from '../machine/service.js';
import { recordRatedResult } from '../ratings/service.js';
import { GameActor, gameTopic, type ActorDeps } from './actor.js';
import { familyOf, type Outcome } from './engine.js';
import type { MachinePlayer } from './machine.js';
import { settlePredictionsFor, spectatorReactions } from './spectators.js';
import { insertGame, loadGame, playingGameIds, type GameConfig, type GameContext, type GameRulesConfig, type SeatConfig } from './store.js';

/** Ce que reçoivent les écouteurs de fin de partie (même forme que LeagueGameFinished). */
export interface GameFinishedEvent {
  gameId: string;
  context: GameContext;
  variant: string;
  ranked: boolean;
  league?: { leagueId: string; matchId: string };
  room?: { roomId: string; code: string; leg: 1 | 2 | null };
  outcome: { places: Record<string, number>; draw: boolean; reason: string };
  seats: { seat: number; userId: string | null; staking: boolean }[];
  pieceDiff?: number;
  tokensHome?: Record<string, number>;
  stake: number;
}

export type GameFinishedListener = (event: GameFinishedEvent) => Promise<void> | void;

export interface CreateGameInput {
  context: GameContext;
  variant: string;
  seats: Omit<SeatConfig, 'seat'>[];
  ranked: boolean;
  stake: number;
  clock: { initialMs: number; incrementMs: number } | null;
  turnMs: number | null;
  teams?: number[][] | null;
  house?: Record<string, string> | null;
  league?: { leagueId: string; matchId: string } | null;
  room?: { roomId: string; code: string; leg: 1 | 2 | null } | null;
  listed?: boolean;
  startAt?: Date;
}

export interface GamesServiceDeps {
  db: Pool;
  clock: Clock;
  log: Logger;
  hub: RealtimeHub;
  machine: MachinePlayer;
  machineDelayMs: number;
}

/** Une partie finie reste en mémoire 10 min (abonnés tardifs), puis est relue en base. */
const FINISHED_TTL_MS = 10 * 60_000;

export class GamesService {
  private readonly actors = new Map<string, GameActor>();
  private readonly finishedAt = new Map<string, number>();
  private readonly loading = new Map<string, Promise<GameActor | null>>();
  private readonly listeners: GameFinishedListener[] = [];
  private readonly background = new Set<Promise<unknown>>();
  private readonly actorDeps: ActorDeps;

  constructor(private readonly deps: GamesServiceDeps) {
    this.actorDeps = {
      db: deps.db,
      clock: deps.clock,
      log: deps.log,
      hub: deps.hub,
      machine: deps.machine,
      machineDelayMs: deps.machineDelayMs,
      settle: (tx, actor, outcome) => this.settle(tx, actor, outcome),
      afterEnd: (actor, outcome) => this.afterEnd(actor, outcome),
      spectatorReactions: (gameId) => spectatorReactions(deps.db, gameId),
    };
  }

  onGameFinished(listener: GameFinishedListener): void {
    this.listeners.push(listener);
  }

  // ------------------------------------------------------------------
  // Création
  // ------------------------------------------------------------------

  /**
   * Crée une partie dans la transaction `tx` (mises bloquées sur le séquestre si `stake` > 0).
   * L'acteur démarre après la validation de la transaction.
   */
  async createGame(tx: Transaction, input: CreateGameInput): Promise<GameConfig> {
    const family = familyOf(input.variant);
    const rules: GameRulesConfig = {
      clock: family === 'dames' ? input.clock : null,
      turnMs: family === 'ludo' ? input.turnMs : null,
      players: input.seats.length,
      teams: input.teams ?? null,
      house: input.house ?? null,
      machine: null,
      league: input.league ?? null,
      room: input.room ?? null,
      absence: input.context !== 'machine',
    };
    const config = await insertGame(tx, {
      context: input.context,
      variant: input.variant,
      ranked: input.ranked,
      stake: input.stake,
      seats: input.seats,
      rules,
      roomId: input.room?.roomId ?? null,
      startedAt: input.startAt ?? this.deps.clock.now(),
      listed: input.listed ?? true,
    });
    const stakers = config.seats.filter((s) => s.staking && s.userId);
    if (input.stake > 0 && stakers.length >= 2) {
      await lockStakes(
        tx,
        config.id,
        stakers.map((s) => ({ userId: s.userId!, amount: input.stake })),
      ).catch((err: unknown) => {
        if (err instanceof AppError && err.code === 'wallet.insufficient_funds') throw new AppError('stake.insufficient', 409);
        throw err;
      });
    }
    tx.afterCommit(() => {
      void this.get(config.id);
    });
    return config;
  }

  /** POST /v1/games/machine : partie contre la machine sur le serveur (avec ou sans pari). */
  async createMachineGame(user: { userId: string; pseudo: string; canBet: boolean }, req: CreateMachineGameRequest): Promise<{ gameId: string }> {
    try {
      assertVariant(req.family, req.variant);
    } catch {
      throw new AppError('game.machine_invalid', 400, { reason: 'variant' });
    }
    const now = this.deps.clock.now();
    const machines = req.family === 'dames' ? 1 : req.variant === 'ludo_pachisi' ? 3 : (req.machines ?? 1);
    if (req.family === 'ludo' && req.variant === 'ludo_six' ? machines > 5 : machines > 3) throw new AppError('game.machine_invalid', 400, { reason: 'machines' });
    const offers = await machineOffers(this.deps.db, { userId: user.userId, canBet: user.canBet }, { family: req.family, variant: req.variant, machines } as never, now);
    const difficulty = req.mode === 'auto' ? offers.auto.difficulty : req.difficulty;
    const offer = offers.difficulties.find((d) => d.id === difficulty);
    if (!offer || !offer.unlocked) throw new AppError('machine.difficulty_locked', 403, { difficulty });
    if (req.bet > 0 && !user.canBet) throw new AppError('stake.underage', 403);
    const balance = await balanceOf(this.deps.db, user.userId);
    const refusal = validateMachineBet(req.bet, balance);
    if (refusal) throw new AppError('machine.invalid_bet', 400, { reason: refusal, cap: offers.betCap });

    const seed = Math.floor(Math.random() * 0x7fffffff);
    const config = await transaction(this.deps.db, async (tx) => {
      const players = 1 + machines;
      const seats: Omit<SeatConfig, 'seat'>[] = Array.from({ length: players }, (_, i) =>
        i === 0
          ? { userId: user.userId, name: user.pseudo, staking: false, guest: false }
          : { userId: null, name: `machine.${difficulty}`, machine: { difficulty }, staking: false, guest: false },
      );
      const cfg = await insertGame(tx, {
        context: 'machine',
        variant: req.variant,
        ranked: isRatedVariant(req.variant),
        stake: 0,
        seats,
        rules: {
          clock: null,
          turnMs: null,
          players,
          teams: req.variant === 'ludo_pachisi' ? [[0, 2], [1, 3]] : null,
          house: null,
          machine: {
            userId: user.userId,
            difficulty,
            mode: req.mode,
            bet: req.bet,
            oddsHundredths: offer.oddsHundredths,
            machineRating: offer.machineRating,
            seed,
            machines,
          },
          league: null,
          room: null,
          absence: false,
        },
        startedAt: now,
        listed: false,
      });
      if (req.bet > 0) {
        await lockStake(tx, cfg.id, { userId: user.userId, amount: req.bet }).catch((err: unknown) => {
          if (err instanceof AppError && err.code === 'wallet.insufficient_funds') throw new AppError('stake.insufficient', 409);
          throw err;
        });
      }
      return cfg;
    });
    await this.get(config.id);
    return { gameId: config.id };
  }

  // ------------------------------------------------------------------
  // Registre
  // ------------------------------------------------------------------

  /** L'acteur d'une partie : en mémoire, sinon relu en base (reprise). null si inconnue. */
  get(gameId: string): Promise<GameActor | null> {
    const existing = this.actors.get(gameId);
    if (existing) return Promise.resolve(existing);
    const inFlight = this.loading.get(gameId);
    if (inFlight) return inFlight;
    const p = (async () => {
      const loaded = await loadGame(this.deps.db, gameId);
      if (!loaded) return null;
      const actor = new GameActor(loaded.config, this.actorDeps, loaded);
      actor.resumeClocks();
      this.actors.set(gameId, actor);
      if (actor.status !== 'playing') this.finishedAt.set(gameId, this.deps.clock.now().getTime());
      else void actor.start();
      return actor;
    })().finally(() => this.loading.delete(gameId));
    this.loading.set(gameId, p);
    return p;
  }

  async require(gameId: string): Promise<GameActor> {
    if (!/^[0-9a-f-]{36}$/i.test(gameId)) throw new AppError('game.not_found', 404);
    const actor = await this.get(gameId);
    if (!actor) throw new AppError('game.not_found', 404);
    return actor;
  }

  /** Acteurs en mémoire (vues en direct). */
  live(): GameActor[] {
    return [...this.actors.values()].filter((a) => a.status === 'playing');
  }

  /** Reprise au démarrage : toutes les parties en cours sont rejouées depuis la base. */
  async resumeAll(): Promise<number> {
    const ids = await playingGameIds(this.deps.db);
    for (const id of ids) {
      try {
        await this.get(id);
      } catch (err) {
        this.deps.log.error({ err, gameId: id }, 'reprise de partie impossible');
      }
    }
    return ids.length;
  }

  /** Un passage de la minuterie (chaque seconde en production). */
  async tick(): Promise<void> {
    const now = this.deps.clock.now().getTime();
    await Promise.all(this.live().map((a) => a.tick().catch((err: unknown) => this.deps.log.error({ err, gameId: a.id }, 'minuterie de partie en échec'))));
    for (const [id, at] of this.finishedAt) {
      if (now - at < FINISHED_TTL_MS) continue;
      const actor = this.actors.get(id);
      if (actor && this.deps.hub.subscribers(gameTopic(id)).length > 0) continue;
      actor?.dispose();
      this.actors.delete(id);
      this.finishedAt.delete(id);
    }
  }

  /** Présence d'un joueur : prévient les parties où il est assis. */
  async presence(userId: string, online: boolean): Promise<void> {
    await Promise.all(this.live().filter((a) => a.isPlayer(userId)).map((a) => a.presence(userId, online)));
  }

  /** Attend que toutes les parties (et les tâches de fond) se soient posées (tests). */
  async settled(gameId?: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const actors = gameId ? [this.actors.get(gameId)].filter((a): a is GameActor => !!a) : [...this.actors.values()];
      await Promise.all(actors.map((a) => a.settled()));
      await Promise.all([...this.background]);
      await new Promise((r) => setImmediate(r));
      const busy = actors.some((a) => a.status === 'playing' && (a as unknown as { pending: number }).pending > 0);
      if (!busy && this.background.size === 0) return;
    }
  }

  close(): void {
    for (const a of this.actors.values()) a.dispose();
    this.actors.clear();
  }

  // ------------------------------------------------------------------
  // Fin de partie
  // ------------------------------------------------------------------

  private async settle(tx: Transaction, actor: GameActor, outcome: Outcome): Promise<void> {
    const cfg = actor.config;
    const places = (seat: number) => outcome.places[seat] ?? cfg.seats.length;
    // Contre la machine : gains, pari, série, force (C2).
    if (cfg.context === 'machine' && cfg.rules.machine) {
      const m = cfg.rules.machine;
      const mine = places(0);
      const result = outcome.draw ? 'draw' : mine === 1 ? 'win' : 'loss';
      await settleMachineOnline(tx, {
        userId: m.userId,
        gameId: cfg.id,
        family: cfg.family,
        variant: cfg.variant,
        difficulty: m.difficulty,
        mode: m.mode,
        bet: m.bet,
        outcome: result,
        machines: m.machines,
        places: cfg.seats.map((s) => places(s.seat)),
        oddsHundredths: m.oddsHundredths,
        machineRating: m.machineRating,
        at: this.deps.clock.now(),
      });
    } else if (cfg.ranked && isRatedVariant(cfg.variant) && cfg.seats.every((s) => s.userId && !s.guest)) {
      // Force (C1) : parties classées entre profils seulement.
      await recordRatedResult(tx, {
        gameId: cfg.id,
        variant: cfg.variant,
        participants: cfg.seats.map((s) => ({ userId: s.userId, place: places(s.seat) })),
        context: cfg.context,
      });
    }
    // Mises entre joueurs : le pot au gagnant, rendu en cas de nulle.
    const stakers = cfg.seats.filter((s) => s.staking && s.userId);
    if (cfg.stake > 0 && stakers.length >= 2) {
      if (outcome.draw) await refundStakes(tx, cfg.id);
      else {
        const winners = actor.winners();
        let paid = stakers.filter((s) => winners.includes(s.seat));
        if (paid.length === 0) {
          // Un invité (sans mise) a gagné : le pot va au(x) mieux classé(s) parmi ceux qui misent.
          const best = Math.min(...stakers.map((s) => places(s.seat)));
          paid = stakers.filter((s) => places(s.seat) === best);
        }
        await payoutPot(
          tx,
          cfg.id,
          paid.map((s) => s.userId!),
          { players: stakers.length },
        );
      }
    }
    // Pronostics des spectateurs.
    const winners = actor.winners();
    await settlePredictionsFor(tx, cfg.id, outcome.draw || winners.length !== 1 ? null : winners[0]!);
  }

  private async afterEnd(actor: GameActor, outcome: Outcome): Promise<void> {
    const cfg = actor.config;
    const pieceDiff = actor.pieceDiff();
    const tokensHome = actor.tokensHome();
    const event: GameFinishedEvent = {
      gameId: cfg.id,
      context: cfg.context,
      variant: cfg.variant,
      ranked: cfg.ranked,
      ...(cfg.rules.league ? { league: cfg.rules.league } : {}),
      ...(cfg.rules.room ? { room: cfg.rules.room } : {}),
      outcome: { places: Object.fromEntries(Object.entries(outcome.places).map(([k, v]) => [k, v])), draw: outcome.draw, reason: outcome.reason },
      seats: cfg.seats.map((s) => ({ seat: s.seat, userId: s.userId, staking: s.staking })),
      ...(pieceDiff !== undefined ? { pieceDiff } : {}),
      ...(tokensHome ? { tokensHome } : {}),
      stake: cfg.stake,
    };
    this.finishedAt.set(cfg.id, this.deps.clock.now().getTime());
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (err) {
        this.deps.log.error({ err, gameId: cfg.id }, 'écouteur de fin de partie en échec');
      }
    }
    // Anti-triche : partie de dames classée avec mise ou de ligue → accord avec le moteur.
    if (cfg.family === 'dames' && cfg.ranked && (cfg.stake > 0 || cfg.context === 'league')) {
      const job = this.reviewAgreement(cfg, [...actor.rules.moves]).catch((err: unknown) => this.deps.log.error({ err, gameId: cfg.id }, 'revue anti-triche en échec'));
      this.background.add(job);
      void job.finally(() => this.background.delete(job));
    }
  }

  /** Tâche de fond : jamais de sanction automatique, seulement une ligne à revoir. */
  private async reviewAgreement(cfg: GameConfig, moves: string[]): Promise<void> {
    for (const s of cfg.seats) {
      if (!s.userId) continue;
      const report = await agreementRate(cfg.variant as 'dames10' | 'dames8', moves, s.seat === 0 ? 'w' : 'b', { maxNodesPerMove: 10_000 });
      if (!report.reviewNeeded) continue;
      await this.deps.db.query(
        `INSERT INTO moderation_flags (game_id, user_id, kind, details) VALUES ($1, $2, 'engine_agreement', $3)
         ON CONFLICT DO NOTHING`,
        [cfg.id, s.userId, JSON.stringify(report)],
      );
    }
  }
}
