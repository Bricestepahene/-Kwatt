/**
 * Séquestre des mises d'une partie (SPEC §7, planche Système « Une mise, pas à pas ») :
 *   1. les deux joueurs acceptent : `lockStakes` bloque les mises sur le séquestre `game:<id>` ;
 *   2. fin de partie : `payoutPot` verse le pot au(x) gagnant(s) ;
 *      nul (Dames) ou partie annulée : `refundStakes` rend à chacun sa mise ;
 *      abandon ou absence de plus de 60 s : défaite, la mise reste dans le pot.
 * Chaque étape a sa clé d'idempotence : rejouer une fin de partie ne paie jamais deux fois.
 * Les contrôles d'âge, de plafond et d'appareil partagé se font AVANT (module Parties).
 */
import type { Pool, Transaction } from '../../db/pool.js';
import { transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { escrowBalance, findTransfer, transfer, type TransferResult } from './ledger.js';

export function gameEscrowKey(gameId: string): string {
  return `game:${gameId}`;
}

export interface Stake {
  userId: string;
  amount: number;
}

/** Bloque la mise d'un joueur (idempotent par partie et par joueur). */
export async function lockStake(db: Pool | Transaction, gameId: string, stake: Stake): Promise<TransferResult> {
  if (!Number.isSafeInteger(stake.amount) || stake.amount <= 0) {
    throw new AppError('ledger.invalid_entries', 500, { reason: 'stake_amount' });
  }
  return transfer(db, {
    kind: 'stake_lock',
    idempotencyKey: `stake_lock:${gameId}:${stake.userId}`,
    gameId,
    entries: [
      { wallet: { userId: stake.userId }, amount: -stake.amount },
      { wallet: { escrow: gameEscrowKey(gameId), gameId }, amount: stake.amount },
    ],
  });
}

/** Bloque toutes les mises d'une partie, tout ou rien (un solde insuffisant annule l'ensemble). */
export async function lockStakes(db: Pool | Transaction, gameId: string, stakes: Stake[]): Promise<void> {
  await transaction(db, async (tx) => {
    for (const s of stakes) await lockStake(tx, gameId, s);
  });
}

/**
 * Verse le pot aux gagnants, à parts égales (le reste éventuel, en cauris entiers, va aux
 * premiers de la liste). Rend null si le pot est vide.
 */
export async function payoutPot(
  db: Pool | Transaction,
  gameId: string,
  winnerIds: string[],
  meta: Record<string, unknown> = {},
): Promise<TransferResult | null> {
  if (winnerIds.length === 0 || new Set(winnerIds).size !== winnerIds.length) {
    throw new AppError('ledger.invalid_entries', 500, { reason: 'winners' });
  }
  return transaction(db, async (tx) => {
    const key = gameEscrowKey(gameId);
    // Verrou du séquestre avant de lire son solde.
    await tx.query('SELECT id FROM wallets WHERE escrow_key = $1 FOR UPDATE', [key]);
    const total = await escrowBalance(tx, key);
    // Pot vide : déjà versé (on rend le versement d'origine) ou rien n'a été misé.
    if (total === 0) return findTransfer(tx, `stake_payout:${gameId}`);
    const base = Math.floor(total / winnerIds.length);
    let rest = total - base * winnerIds.length;
    const entries = winnerIds.map((userId) => {
      const share = base + (rest > 0 ? 1 : 0);
      if (rest > 0) rest--;
      return { wallet: { userId }, amount: share };
    });
    return transfer(tx, {
      kind: 'stake_payout',
      idempotencyKey: `stake_payout:${gameId}`,
      gameId,
      meta,
      entries: [{ wallet: { escrow: key, gameId }, amount: -total }, ...entries.filter((e) => e.amount > 0)],
    });
  });
}

/**
 * Rend à chaque joueur ce qu'il a encore sur le séquestre (nul aux Dames, partie annulée).
 * `userIds` limite le remboursement à certains joueurs (un joueur qui quitte avant le début).
 */
export async function refundStakes(db: Pool | Transaction, gameId: string, userIds?: string[]): Promise<TransferResult | null> {
  return transaction(db, async (tx) => {
    const key = gameEscrowKey(gameId);
    await tx.query('SELECT id FROM wallets WHERE escrow_key = $1 FOR UPDATE', [key]);
    const r = await tx.query<{ user_id: string; net: number }>(
      `SELECT w.user_id, -SUM(e.amount)::bigint AS net
         FROM ledger_entries e
         JOIN ledger_transactions t ON t.id = e.tx_id
         JOIN wallets w ON w.id = e.wallet_id
        WHERE t.game_id = $1 AND t.kind IN ('stake_lock', 'stake_refund') AND w.kind = 'player'
        GROUP BY w.user_id
       HAVING -SUM(e.amount) > 0
        ORDER BY w.user_id`,
      [gameId],
    );
    const due = r.rows.filter((row) => userIds === undefined || userIds.includes(row.user_id));
    if (due.length === 0) return null;
    const total = due.reduce((s, row) => s + row.net, 0);
    const suffix = userIds === undefined ? '' : `:${[...userIds].sort().join(',')}`;
    return transfer(tx, {
      kind: 'stake_refund',
      idempotencyKey: `stake_refund:${gameId}${suffix}`,
      gameId,
      entries: [
        { wallet: { escrow: key, gameId }, amount: -total },
        ...due.map((row) => ({ wallet: { userId: row.user_id }, amount: row.net })),
      ],
    });
  });
}
