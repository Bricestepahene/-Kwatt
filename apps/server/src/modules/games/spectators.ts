/**
 * Spectateurs (écran 37) : pronostics en pari mutuel (D-09 : 50 cauris, profils de 18 ans et
 * plus, fermés au coup ou au tour 10) et réactions, montrées aux joueurs à la fin seulement.
 * Les cauris passent par le séquestre `predictions:<partie>` du grand livre.
 */
import {
  PREDICTION_CLOSE_AT,
  PREDICTION_STAKE,
  predictionsOpen,
  settlePredictions,
} from '@kwatt/domain';
import { GAME_REACTIONS, type GameReaction, type PredictionsView } from '@kwatt/protocol';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { transfer } from '../economy/ledger.js';
import type { GameActor } from './actor.js';

export const predictionEscrowKey = (gameId: string): string => `predictions:${gameId}`;

/** Les pronostics de cette partie sont-ils encore ouverts ? */
export function predictionsOpenFor(actor: GameActor): boolean {
  if (actor.status !== 'playing') return false;
  const state = actor.rules.state as { ply?: number; turnNo?: number };
  return actor.config.family === 'dames'
    ? predictionsOpen({ kind: 'dames', ply: state.ply ?? 0 })
    : predictionsOpen({ kind: 'ludo', round: Math.ceil((state.turnNo ?? 1) / Math.max(1, actor.config.seats.length)) });
}

export async function predictionsView(db: Sql, actor: GameActor, viewer: { userId: string; canBet: boolean } | null): Promise<PredictionsView> {
  const r = await db.query<{ seat: number; count: number }>('SELECT seat, count(*)::int AS count FROM predictions WHERE game_id = $1 GROUP BY seat', [actor.id]);
  const mine = viewer
    ? (await db.query<{ seat: number; payout: number | null }>('SELECT seat, payout FROM predictions WHERE game_id = $1 AND user_id = $2', [actor.id, viewer.userId])).rows[0]
    : undefined;
  const counts = new Map(r.rows.map((x) => [x.seat, x.count]));
  return {
    open: predictionsOpenFor(actor),
    stake: PREDICTION_STAKE,
    closesAt: PREDICTION_CLOSE_AT,
    pools: actor.config.seats.map((s) => ({ seat: s.seat, count: counts.get(s.seat) ?? 0, total: (counts.get(s.seat) ?? 0) * PREDICTION_STAKE })),
    mine: mine ? { seat: mine.seat, payout: mine.payout } : null,
    eligible: !!viewer && viewer.canBet && !actor.isPlayer(viewer.userId),
  };
}

/** Pronostiquer : 50 cauris bloqués sur le séquestre des pronostics. */
export async function placePrediction(db: Pool, actor: GameActor, viewer: { userId: string; canBet: boolean }, seat: number): Promise<void> {
  if (!viewer.canBet) throw new AppError('stake.underage', 403);
  if (actor.isPlayer(viewer.userId)) throw new AppError('prediction.player', 403);
  if (!actor.config.seats.some((s) => s.seat === seat)) throw new AppError('prediction.invalid_seat', 400);
  // Le contrôle de fermeture passe par la file de la partie : aucun coup ne s'intercale.
  await actor.enqueue(async () => {
    if (actor.status !== 'playing') throw new AppError('game.over', 409);
    if (!predictionsOpenFor(actor)) throw new AppError('prediction.closed', 409);
    await transaction(db, async (tx) => {
      const ins = await tx.query('INSERT INTO predictions (game_id, user_id, seat, stake) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [
        actor.id,
        viewer.userId,
        seat,
        PREDICTION_STAKE,
      ]);
      if (ins.rowCount === 0) throw new AppError('prediction.already', 409);
      await transfer(tx, {
        kind: 'prediction_lock',
        idempotencyKey: `prediction_lock:${actor.id}:${viewer.userId}`,
        gameId: actor.id,
        entries: [
          { wallet: { userId: viewer.userId }, amount: -PREDICTION_STAKE },
          { wallet: { escrow: predictionEscrowKey(actor.id) }, amount: PREDICTION_STAKE },
        ],
      }).catch((err: unknown) => {
        if (err instanceof AppError && err.code === 'wallet.insufficient_funds') throw new AppError('stake.insufficient', 409);
        throw err;
      });
    });
  });
}

/** Règlement des pronostics (dans la transaction de fin de partie). `winnerSeat` null : remboursement. */
export async function settlePredictionsFor(tx: Transaction, gameId: string, winnerSeat: number | null): Promise<void> {
  const r = await tx.query<{ user_id: string; seat: number }>('SELECT user_id, seat FROM predictions WHERE game_id = $1 ORDER BY created_at, user_id', [gameId]);
  if (r.rows.length === 0) return;
  const settlement = settlePredictions(
    r.rows.map((p, order) => ({ userId: p.user_id, pick: String(p.seat), order })),
    winnerSeat === null ? null : String(winnerSeat),
  );
  const paid = Object.entries(settlement.payouts).filter(([, amount]) => amount > 0);
  const total = paid.reduce((s, [, a]) => s + a, 0);
  if (total > 0) {
    await transfer(tx, {
      kind: settlement.outcome === 'paid' ? 'prediction_payout' : 'prediction_refund',
      idempotencyKey: `prediction_settle:${gameId}`,
      gameId,
      meta: settlement.reason ? { reason: settlement.reason } : {},
      entries: [{ wallet: { escrow: predictionEscrowKey(gameId) }, amount: -total }, ...paid.map(([userId, amount]) => ({ wallet: { userId }, amount }))],
    });
  }
  for (const [userId, amount] of Object.entries(settlement.payouts)) {
    await tx.query('UPDATE predictions SET payout = $3 WHERE game_id = $1 AND user_id = $2', [gameId, userId, amount]);
  }
}

export function reactionKey(raw: string): GameReaction | null {
  const key = raw.replace(/^reaction\./, '');
  return (GAME_REACTIONS as readonly string[]).includes(key) ? (key as GameReaction) : null;
}

/** Réaction d'un spectateur : gardée, montrée aux joueurs à la fin. */
export async function recordSpectatorReaction(db: Sql, gameId: string, userId: string, key: GameReaction): Promise<void> {
  await db.query('INSERT INTO game_reactions (game_id, user_id, key) VALUES ($1, $2, $3)', [gameId, userId, key]);
}

export async function spectatorReactions(db: Sql, gameId: string): Promise<{ key: GameReaction; count: number }[]> {
  const r = await db.query<{ key: GameReaction; count: number }>(
    'SELECT key, count(*)::int AS count FROM game_reactions WHERE game_id = $1 GROUP BY key ORDER BY count DESC, key',
    [gameId],
  );
  return r.rows;
}
