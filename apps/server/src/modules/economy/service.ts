/**
 * Lecture du portefeuille et bonus de bienvenue.
 */
import { WELCOME_BONUS, type JournalEntry } from '@kwatt/protocol';
import type { Pool, Sql, Transaction } from '../../db/pool.js';
import { cursorAt, decodeCursor, pageOf } from '../../lib/cursor.js';
import { balanceOf, transfer } from './ledger.js';

/**
 * Bonus de bienvenue (+500), versé une fois par compte à la création du profil
 * (inscription directe ou conversion d'un invité). Rend le montant versé (0 si déjà versé).
 */
export async function grantWelcomeBonus(db: Pool | Transaction, userId: string): Promise<number> {
  const r = await transfer(db, {
    kind: 'welcome_bonus',
    idempotencyKey: `welcome_bonus:${userId}`,
    entries: [
      { wallet: { system: 'welcome' }, amount: -WELCOME_BONUS },
      { wallet: { userId }, amount: WELCOME_BONUS },
    ],
  });
  return r.replayed ? 0 : WELCOME_BONUS;
}

export async function getBalance(db: Sql, userId: string): Promise<number> {
  return balanceOf(db, userId);
}

interface JournalRow {
  tx_id: string;
  kind: string;
  amount: number;
  balance_after: number;
  game_id: string | null;
  meta: Record<string, unknown>;
  created_at: Date;
}

interface JournalPageRow extends JournalRow {
  cursor_at: string;
}

function toEntry(r: JournalRow): JournalEntry {
  return {
    txId: r.tx_id,
    kind: r.kind,
    amount: r.amount,
    balanceAfter: r.balance_after,
    gameId: r.game_id,
    meta: r.meta,
    createdAt: r.created_at.toISOString(),
  };
}

/** Journal des cauris d'un joueur, du plus récent au plus ancien. */
export async function journal(
  db: Sql,
  userId: string,
  cursor: string | undefined,
  limit: number,
): Promise<{ items: JournalEntry[]; nextCursor: string | null }> {
  const pos = decodeCursor(cursor);
  const r = await db.query<JournalPageRow>(
    `SELECT t.id AS tx_id, t.kind, e.amount, e.balance_after, t.game_id, t.meta, t.created_at,
            ${cursorAt('t.created_at')} AS cursor_at
       FROM wallets w
       JOIN ledger_entries e ON e.wallet_id = w.id
       JOIN ledger_transactions t ON t.id = e.tx_id
      WHERE w.user_id = $1 AND ($2::timestamptz IS NULL OR (t.created_at, t.id) < ($2::timestamptz, $3::uuid))
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $4`,
    [userId, pos?.at ?? null, pos?.id ?? null, limit + 1],
  );
  const page = pageOf(r.rows, limit, (row) => ({ at: row.cursor_at, id: row.tx_id }));
  return { items: page.items.map(toEntry), nextCursor: page.nextCursor };
}

/** Journal complet (export des données). */
export async function fullJournal(db: Sql, userId: string): Promise<JournalEntry[]> {
  const r = await db.query<JournalRow>(
    `SELECT t.id AS tx_id, t.kind, e.amount, e.balance_after, t.game_id, t.meta, t.created_at
       FROM wallets w
       JOIN ledger_entries e ON e.wallet_id = w.id
       JOIN ledger_transactions t ON t.id = e.tx_id
      WHERE w.user_id = $1
      ORDER BY t.created_at, t.id`,
    [userId],
  );
  return r.rows.map(toEntry);
}
