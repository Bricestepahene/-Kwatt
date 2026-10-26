/**
 * Défi contre la machine (contrat C2, écrans 14, 15 et 20) : offres, résultats hors
 * connexion (rejoués), règlement des parties en ligne avec pari (`settleMachineOnline`).
 *
 * Calculs purs dans @kwatt/domain (difficultés, cotes, gains, série ×1,5, difficulté auto,
 * plafond de pari) ; cauris uniquement par le grand livre (`transfer`), avec une clé
 * d'idempotence par mouvement ; force par C1 (`recordRatedResult`), la machine servant
 * d'adversaire.
 */
import {
  DAILY_REWARDED_MACHINE_GAMES,
  MACHINE_DIFFICULTIES,
  applyAutoDifficulty,
  dayKey,
  isDifficultyUnlocked,
  isRatedVariant,
  machineBetCap,
  machineDifficulty,
  machineRating,
  nextWinStreak,
  oddsHundredths,
  rankForRating,
  settleMachineGame,
  type MachineDifficultyId,
  type MachineOutcome,
  type RankId,
  type RatedVariant,
} from '@kwatt/domain';
import {
  MACHINE_VARIANTS,
  type AutoDifficulty,
  type MachineDifficultyOffer,
  type MachineFamily,
  type MachineOffersQuery,
  type MachineOffersResponse,
  type MachineResultRequest,
  type MachineResultResponse,
  type MachineSettlementView,
  type RatingChangeView,
} from '@kwatt/protocol';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { balanceOf, transfer } from '../economy/ledger.js';
import { gameEscrowKey } from '../economy/escrow.js';
import { ratingOf, recordRatedResult } from '../ratings/service.js';
import { InvalidGameError, replayDames, replayLudo } from './replay.js';

const DAY_MS = 86_400_000;
/** Écart toléré entre la force visée envoyée par l'appli et l'offre actuelle du serveur. */
export const MACHINE_RATING_TOLERANCE = 150;
/** Une partie hors connexion compte pour le jour où elle a été jouée, trois jours au plus tôt. */
export const OFFLINE_MAX_AGE_DAYS = 3;

export function assertVariant(family: MachineFamily, variant: string): void {
  if (!(MACHINE_VARIANTS[family] as readonly string[]).includes(variant)) {
    throw new AppError('machine.invalid_variant', 400, { family, variant });
  }
}

/** Variante dont la force règle la machine : la variante elle-même si elle est classée, sinon le Ludo classique. */
function ratingVariant(family: MachineFamily, variant: string): RatedVariant {
  if (isRatedVariant(variant)) return variant;
  return family === 'dames' ? 'dames10' : 'ludo_classique';
}

/**
 * Chance de gagner visée. Ludo à plusieurs machines : modèle de Luce à partir du
 * tête-à-tête (pₙ = 1 ÷ (1 + (n − 1)(1 − p) ÷ p)), comme @kwatt/ludo-ai.
 */
export function targetProbability(p: number, machines: number): number {
  if (machines <= 1) return p;
  const pn = 1 / (1 + (machines * (1 - p)) / p);
  return Math.min(0.95, Math.max(0.02, pn));
}

interface Progress {
  auto: AutoDifficulty;
  winStreak: number;
}

async function readProgress(db: Sql, userId: string, family: MachineFamily, lock = false): Promise<Progress> {
  const r = await db.query<{ auto_difficulty: MachineDifficultyId; auto_streak: number; win_streak: number }>(
    `SELECT auto_difficulty, auto_streak, win_streak FROM machine_progress WHERE user_id = $1 AND family = $2${lock ? ' FOR UPDATE' : ''}`,
    [userId, family],
  );
  const row = r.rows[0];
  return row
    ? { auto: { difficulty: row.auto_difficulty, streak: row.auto_streak }, winStreak: row.win_streak }
    : { auto: { difficulty: 'ton_niveau', streak: 0 }, winStreak: 0 };
}

async function rewardedOn(db: Sql, userId: string, family: MachineFamily, day: string, lock = false): Promise<number> {
  const r = await db.query<{ count: number }>(
    `SELECT count FROM daily_rewards WHERE user_id = $1 AND day = $2 AND family = $3${lock ? ' FOR UPDATE' : ''}`,
    [userId, day, family],
  );
  return r.rows[0]?.count ?? 0;
}

export interface Bettor {
  userId: string;
  /** Profil majeur à l'adresse vérifiée (SPEC §6). */
  canBet: boolean;
}

/** GET /v1/machine/offers */
export async function machineOffers(db: Sql, who: Bettor, query: MachineOffersQuery, now: Date): Promise<MachineOffersResponse> {
  assertVariant(query.family, query.variant);
  const machines = query.family === 'dames' ? 1 : query.variant === 'ludo_pachisi' ? 3 : query.machines;
  const { rating } = await ratingOf(db, who.userId, ratingVariant(query.family, query.variant));
  const rank = rankForRating(rating).id;
  const [progress, rewardedToday, balance] = await Promise.all([
    readProgress(db, who.userId, query.family),
    rewardedOn(db, who.userId, query.family, dayKey(now.getTime())),
    balanceOf(db, who.userId),
  ]);
  const difficulties: MachineDifficultyOffer[] = MACHINE_DIFFICULTIES.map((d) => {
    const p = targetProbability(d.p, machines);
    const oddsH = oddsHundredths(p);
    return {
      id: d.id,
      p: Math.round(p * 10_000) / 10_000,
      odds: oddsH / 100,
      oddsHundredths: oddsH,
      baseReward: d.baseReward,
      unlocked: isDifficultyUnlocked(d.id, rank),
      machineRating: machineRating(rating, d.p),
    };
  });
  return {
    rating,
    rank,
    difficulties,
    auto: clampAuto(progress.auto, rank),
    winStreak: progress.winStreak,
    rewardedToday: Math.min(rewardedToday, DAILY_REWARDED_MACHINE_GAMES),
    dailyLimit: DAILY_REWARDED_MACHINE_GAMES,
    betCap: who.canBet ? machineBetCap(balance) : 0,
  };
}

/** La difficulté automatique ne propose jamais une difficulté verrouillée. */
function clampAuto(auto: AutoDifficulty, rank: RankId): AutoDifficulty {
  if (isDifficultyUnlocked(auto.difficulty, rank)) return auto;
  const unlocked = MACHINE_DIFFICULTIES.filter((d) => isDifficultyUnlocked(d.id, rank));
  return { difficulty: unlocked[unlocked.length - 1]!.id, streak: auto.streak };
}

interface SettleInput {
  userId: string;
  family: MachineFamily;
  variant: string;
  difficulty: MachineDifficultyId;
  mode: 'auto' | 'chosen';
  machines: number;
  machineRating: number;
  outcome: MachineOutcome;
  /** Places de chaque siège (0 : le joueur) ; Dames : déduites de l'issue. */
  places: number[];
  bet: number;
  oddsHundredths: number;
  day: string;
  offline: boolean;
  /** Préfixe des clés d'idempotence (`offline:<user>:<clientGameId>` ou `<gameId>`). */
  key: string;
  gameId: string | null;
  rank: RankId;
}

/** Règlement commun (hors connexion ou en ligne), dans une transaction. */
async function settle(tx: Transaction, input: SettleInput): Promise<MachineResultResponse> {
  // Verrou de la progression du joueur pour ce jeu : deux résultats envoyés en même temps se suivent.
  await tx.query(`INSERT INTO machine_progress (user_id, family) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [input.userId, input.family]);
  const progress = await readProgress(tx, input.userId, input.family, true);
  await tx.query(`INSERT INTO daily_rewards (user_id, day, family) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
    input.userId,
    input.day,
    input.family,
  ]);
  const rewardedToday = await rewardedOn(tx, input.userId, input.family, input.day, true);

  const s = settleMachineGame({
    difficulty: input.difficulty,
    outcome: input.outcome,
    bet: input.bet,
    oddsHundredths: input.oddsHundredths,
    winStreakBefore: progress.winStreak,
    rewardedToday,
    offline: input.offline,
  });
  const meta = { family: input.family, variant: input.variant, difficulty: input.difficulty, outcome: input.outcome };

  if (s.base > 0) {
    await transfer(tx, {
      kind: 'machine_win',
      idempotencyKey: `machine_win:${input.key}`,
      gameId: input.gameId,
      meta: { ...meta, streakBonus: s.streakBonus },
      entries: [
        { wallet: { system: 'rewards' }, amount: -s.base },
        { wallet: { userId: input.userId }, amount: s.base },
      ],
    });
  }
  if (s.participation > 0) {
    await transfer(tx, {
      kind: 'participation',
      idempotencyKey: `participation:${input.key}`,
      gameId: input.gameId,
      meta,
      entries: [
        { wallet: { system: 'rewards' }, amount: -s.participation },
        { wallet: { userId: input.userId }, amount: s.participation },
      ],
    });
  }
  if (input.bet > 0 && input.gameId) {
    // La mise est déjà bloquée sur le séquestre de la partie.
    const escrow = { escrow: gameEscrowKey(input.gameId), gameId: input.gameId };
    const entries =
      input.outcome === 'win'
        ? [
            { wallet: escrow, amount: -input.bet },
            ...(s.betNet > 0 ? [{ wallet: { system: 'house' }, amount: -s.betNet }] : []),
            { wallet: { userId: input.userId }, amount: input.bet + s.betNet },
          ]
        : input.outcome === 'loss'
          ? [
              { wallet: escrow, amount: -input.bet },
              { wallet: { system: 'house' }, amount: input.bet },
            ]
          : [
              { wallet: escrow, amount: -input.bet },
              { wallet: { userId: input.userId }, amount: input.bet },
            ];
    await transfer(tx, {
      kind: 'machine_bet',
      idempotencyKey: `machine_bet:${input.key}`,
      gameId: input.gameId,
      meta: { ...meta, bet: input.bet, oddsHundredths: input.oddsHundredths },
      entries,
    });
  }
  if (s.counted) {
    await tx.query('UPDATE daily_rewards SET count = count + 1 WHERE user_id = $1 AND day = $2 AND family = $3', [
      input.userId,
      input.day,
      input.family,
    ]);
  }

  const auto = input.mode === 'auto' ? applyAutoDifficulty(progress.auto, input.outcome, input.rank) : progress.auto;
  const winStreak = nextWinStreak(progress.winStreak, input.outcome);
  await tx.query(
    `UPDATE machine_progress SET auto_difficulty = $3, auto_streak = $4, win_streak = $5, updated_at = now()
      WHERE user_id = $1 AND family = $2`,
    [input.userId, input.family, auto.difficulty, auto.streak, winStreak],
  );

  let rating: RatingChangeView | null = null;
  if (isRatedVariant(input.variant)) {
    if (!input.gameId) throw new Error('Partie sans identifiant');
    const ratingGameId = input.gameId;
    const participants = input.places.map((place, seat) =>
      seat === 0 ? { userId: input.userId, place } : { userId: null, machineRating: input.machineRating, place },
    );
    const changes = await recordRatedResult(tx, { gameId: ratingGameId, variant: input.variant, participants, context: 'machine' });
    rating = changes[input.userId] ?? null;
  }

  const settlement: MachineSettlementView = { ...s };
  return { outcome: input.outcome, settlement, rating, auto, winStreak };
}

function damesPlaces(outcome: MachineOutcome): number[] {
  return outcome === 'win' ? [1, 2] : outcome === 'loss' ? [2, 1] : [1, 1];
}

/** POST /v1/machine/results : partie hors connexion, rejouée puis réglée (sans pari). */
export async function submitMachineResult(db: Pool, userId: string, req: MachineResultRequest, now: Date): Promise<MachineResultResponse> {
  assertVariant(req.family, req.variant);
  const fingerprint = JSON.stringify({ v: req.variant, d: req.difficulty, s: req.seed, m: req.moves });

  // Renvoi : même réponse, sans rien rejouer ni recompter.
  const previous = await storedResult(db, userId, req.clientGameId, fingerprint);
  if (previous) return previous;

  const machines = req.family === 'dames' ? 1 : req.variant === 'ludo_pachisi' ? 3 : (req.machines ?? 1);
  const { rating } = await ratingOf(db, userId, ratingVariant(req.family, req.variant));
  const rank = rankForRating(rating).id;
  if (!isDifficultyUnlocked(req.difficulty, rank)) {
    throw new AppError('machine.difficulty_locked', 403, { difficulty: req.difficulty, requiredRank: 'chef' });
  }
  const d = machineDifficulty(req.difficulty);
  const expected = machineRating(rating, d.p);
  let target = expected;
  if (req.family === 'dames' && req.machineRating !== undefined) {
    if (Math.abs(req.machineRating - expected) > MACHINE_RATING_TOLERANCE) {
      throw new AppError('machine.rating_mismatch', 422, { expected });
    }
    target = req.machineRating;
  }

  let outcome: MachineOutcome;
  let places: number[];
  try {
    if (req.family === 'dames') {
      const r = replayDames(req.variant as 'dames10' | 'dames8', req.moves, { targetRating: target, seed: req.seed });
      outcome = r.outcome;
      places = damesPlaces(outcome);
    } else {
      const r = replayLudo(req.variant, machines, req.moves);
      outcome = r.outcome;
      places = r.places;
    }
  } catch (err) {
    if (err instanceof InvalidGameError) throw new AppError('machine.invalid_game', 422, { ply: err.ply, reason: err.reason });
    throw err;
  }

  // Jour de la partie (heure du Cameroun), jamais dans le futur ni plus de 3 jours en arrière.
  const nowMs = now.getTime();
  const playedMs = Math.min(nowMs, Math.max(nowMs - OFFLINE_MAX_AGE_DAYS * DAY_MS, Date.parse(req.playedAt)));
  const day = dayKey(playedMs);
  const oddsH = oddsHundredths(targetProbability(d.p, machines));

  return transaction(db, async (tx) => {
    // Verrou par joueur : un renvoi simultané attend le premier, puis rend sa réponse.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`machine:${userId}`]);
    const again = await storedResult(tx, userId, req.clientGameId, fingerprint);
    if (again) return again;
    const gameId = await insertOfflineGame(tx, {
      userId,
      family: req.family,
      variant: req.variant,
      difficulty: req.difficulty,
      machines,
      machineRating: target,
      seed: req.seed,
      places,
      outcome,
      playedAt: new Date(playedMs),
    });
    const response = await settle(tx, {
      userId,
      family: req.family,
      variant: req.variant,
      difficulty: req.difficulty,
      mode: req.mode,
      machines,
      machineRating: target,
      outcome,
      places,
      bet: 0,
      oddsHundredths: oddsH,
      day,
      offline: true,
      key: `offline:${userId}:${req.clientGameId}`,
      gameId,
      rank,
    });
    await tx.query(
      `INSERT INTO machine_results (user_id, client_game_id, family, variant, difficulty, mode, machines, machine_rating,
                                    seed, moves, outcome, bet, day, played_at, response, game_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13, $14, $15)`,
      [
        userId,
        req.clientGameId,
        req.family,
        req.variant,
        req.difficulty,
        req.mode,
        machines,
        target,
        req.seed,
        JSON.stringify({ fingerprint, moves: req.moves }),
        outcome,
        day,
        new Date(playedMs).toISOString(),
        JSON.stringify(response),
        gameId,
      ],
    );
    return response;
  });
}

/**
 * Une partie hors connexion devient une partie terminée du serveur (`games` + `game_players`) :
 * le journal des cauris, la force (rating_history) et les « derniers matchs » du profil
 * s'y rattachent. Les coups restent dans `machine_results` (rejeu déjà fait).
 */
export async function insertOfflineGame(
  tx: Sql,
  g: {
    userId: string;
    family: MachineFamily;
    variant: string;
    difficulty: MachineDifficultyId;
    machines: number;
    machineRating: number;
    seed: number;
    places: number[];
    outcome: MachineOutcome;
    playedAt: Date;
  },
): Promise<string> {
  const rules = { offline: true, difficulty: g.difficulty, machines: g.machines, machineRating: g.machineRating, seed: g.seed };
  const r = await tx.query<{ id: string }>(
    `INSERT INTO games (context, variant, rules, rules_version, ranked, status, end_reason, started_at, ended_at)
     VALUES ('machine', $1, $2, 'offline-1', $3, 'finished', $4, $5, $5) RETURNING id`,
    [g.variant, JSON.stringify(rules), isRatedVariant(g.variant), g.outcome, g.playedAt.toISOString()],
  );
  const gameId = r.rows[0]!.id;
  const pseudo = await tx.query<{ pseudo: string }>('SELECT pseudo::text AS pseudo FROM profiles WHERE user_id = $1', [g.userId]);
  for (const [seat, place] of g.places.entries()) {
    const human = seat === 0;
    const result = g.outcome === 'draw' ? 'draw' : human ? g.outcome : g.outcome === 'win' ? 'loss' : place === 1 ? 'win' : 'loss';
    await tx.query(
      `INSERT INTO game_players (game_id, seat, user_id, display_name, color, place, result) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        gameId,
        seat,
        human ? g.userId : null,
        human ? (pseudo.rows[0]?.pseudo ?? '') : `machine.${g.difficulty}`,
        g.family === 'dames' ? (human ? 'w' : 'b') : String(seat),
        g.outcome === 'draw' ? null : place,
        result,
      ],
    );
  }
  return gameId;
}

async function storedResult(db: Sql, userId: string, clientGameId: string, fingerprint: string): Promise<MachineResultResponse | null> {
  const r = await db.query<{ moves: { fingerprint?: string }; response: MachineResultResponse }>(
    'SELECT moves, response FROM machine_results WHERE user_id = $1 AND client_game_id = $2',
    [userId, clientGameId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.moves.fingerprint !== fingerprint) throw new AppError('machine.result_conflict', 409, { clientGameId });
  return row.response;
}

export interface OnlineSettlementInput {
  userId: string;
  gameId: string;
  family: MachineFamily;
  variant: string;
  difficulty: MachineDifficultyId;
  mode: 'auto' | 'chosen';
  /** Mise déjà bloquée sur le séquestre `game:<gameId>` (0 : sans pari). */
  bet: number;
  outcome: MachineOutcome;
  /** Ludo : nombre de machines (1 à 3). */
  machines?: number;
  /** Places par siège (siège 0 : le joueur) ; Ludo à plusieurs machines. */
  places?: number[];
  /** Cote figée au moment du pari (sinon recalculée sur la force actuelle). */
  oddsHundredths?: number;
  /** Force de la machine pendant la partie (sinon recalculée). */
  machineRating?: number;
  /** Jour de la partie (défaut : aujourd'hui, heure du Cameroun). */
  at?: Date;
}

/**
 * Règlement d'une partie contre la machine jouée sur le serveur (C3, avec ou sans pari),
 * dans la transaction de fin de partie. Idempotent par partie : un second appel rend la
 * même réponse sans rien recompter.
 */
export async function settleMachineOnline(db: Pool | Transaction, input: OnlineSettlementInput): Promise<MachineResultResponse> {
  assertVariant(input.family, input.variant);
  return transaction(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`machine:${input.userId}`]);
    const prev = await tx.query<{ response: MachineResultResponse }>(
      'SELECT response FROM machine_results WHERE user_id = $1 AND game_id = $2',
      [input.userId, input.gameId],
    );
    if (prev.rows[0]) return prev.rows[0].response;

    const machines = input.family === 'dames' ? 1 : input.variant === 'ludo_pachisi' ? 3 : (input.machines ?? 1);
    const { rating } = await ratingOf(tx, input.userId, ratingVariant(input.family, input.variant));
    const rank = rankForRating(rating).id;
    const d = machineDifficulty(input.difficulty);
    const mRating = input.machineRating ?? machineRating(rating, d.p);
    const oddsH = input.oddsHundredths ?? oddsHundredths(targetProbability(d.p, machines));
    const places =
      input.places ??
      (input.family === 'dames'
        ? damesPlaces(input.outcome)
        : Array.from({ length: machines + 1 }, (_, seat) => (seat === 0 ? (input.outcome === 'win' ? 1 : machines + 1) : input.outcome === 'win' ? seat + 1 : seat)));
    const at = input.at ?? new Date();
    const response = await settle(tx, {
      userId: input.userId,
      family: input.family,
      variant: input.variant,
      difficulty: input.difficulty,
      mode: input.mode,
      machines,
      machineRating: mRating,
      outcome: input.outcome,
      places,
      bet: input.bet,
      oddsHundredths: oddsH,
      day: dayKey(at.getTime()),
      offline: false,
      key: input.gameId,
      gameId: input.gameId,
      rank,
    });
    await tx.query(
      `INSERT INTO machine_results (user_id, game_id, family, variant, difficulty, mode, machines, machine_rating,
                                    outcome, bet, day, played_at, response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        input.userId,
        input.gameId,
        input.family,
        input.variant,
        input.difficulty,
        input.mode,
        machines,
        mRating,
        input.outcome,
        input.bet,
        dayKey(at.getTime()),
        at.toISOString(),
        JSON.stringify(response),
      ],
    );
    return response;
  });
}
