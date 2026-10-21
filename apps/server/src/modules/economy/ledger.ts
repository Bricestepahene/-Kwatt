/**
 * Grand livre des cauris, en partie double (SPEC §7, règle intangible du CLAUDE.md).
 *
 *   await transfer(db, {
 *     kind: 'machine_win',
 *     idempotencyKey: `machine_win:${gameId}`,
 *     gameId,
 *     entries: [
 *       { wallet: { system: 'rewards' }, amount: -25 },
 *       { wallet: { userId }, amount: +25 },
 *     ],
 *   });
 *
 * Garanties :
 * - la somme des écritures vaut 0 (contrôle ici ET contrainte différée en base) ;
 * - les portefeuilles sont verrouillés (SELECT … FOR UPDATE, dans l'ordre des identifiants :
 *   pas d'interblocage) ; un portefeuille joueur ou séquestre ne passe jamais sous zéro ;
 * - la clé d'idempotence est unique : rejouer le même mouvement ne le compte pas deux fois ;
 * - les soldes ne bougent que par ici : la base refuse tout autre UPDATE du solde (0003).
 *
 * `db` peut être le pool (transaction propre) ou une transaction en cours : le versement
 * d'une mise se fait ainsi dans la même transaction que le résultat de la partie.
 */
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

/** Portefeuille visé par une écriture. */
export type WalletRef =
  | { userId: string }
  | { system: string }
  | { escrow: string; gameId?: string }
  | { walletId: string };

export interface TransferEntry {
  wallet: WalletRef;
  /** + crédit, − débit, en cauris (entier non nul). */
  amount: number;
}

export interface TransferInput {
  /** Nature du mouvement (voir LEDGER_KINDS de @kwatt/protocol), ex. 'stake_lock'. */
  kind: string;
  entries: TransferEntry[];
  /** Clé unique du mouvement, ex. 'stake_payout:<gameId>' : jamais deux versements. */
  idempotencyKey: string;
  gameId?: string | null;
  /** Détails d'affichage (adversaire, quête…), jamais une phrase. */
  meta?: Record<string, unknown>;
}

export interface TransferResult {
  txId: string;
  /** true si ce mouvement existait déjà (clé déjà utilisée) : rien n'a été réécrit. */
  replayed: boolean;
  entries: Array<{ walletId: string; amount: number; balanceAfter: number }>;
}

const KIND_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

function validate(input: TransferInput): void {
  const bad = (reason: string) => new AppError('ledger.invalid_entries', 500, { reason });
  if (!KIND_PATTERN.test(input.kind)) throw bad('kind');
  if (input.idempotencyKey.length === 0 || input.idempotencyKey.length > 200) throw bad('idempotency_key');
  if (input.entries.length < 2) throw bad('entries');
  let sum = 0;
  for (const e of input.entries) {
    if (!Number.isSafeInteger(e.amount) || e.amount === 0) throw bad('amount');
    sum += e.amount;
  }
  if (sum !== 0) throw bad('unbalanced');
}

/** Identifiant du portefeuille visé, créé au besoin (joueur, séquestre, compte système). */
export async function resolveWallet(db: Sql, ref: WalletRef): Promise<string> {
  if ('walletId' in ref) return ref.walletId;
  if ('userId' in ref) {
    await db.query(`INSERT INTO wallets (kind, user_id) VALUES ('player', $1) ON CONFLICT (user_id) DO NOTHING`, [ref.userId]);
    const r = await db.query<{ id: string }>('SELECT id FROM wallets WHERE user_id = $1', [ref.userId]);
    const id = r.rows[0]?.id;
    if (!id) throw new AppError('wallet.not_found', 404);
    return id;
  }
  if ('system' in ref) {
    await db.query(`INSERT INTO wallets (kind, system_code) VALUES ('system', $1) ON CONFLICT (system_code) DO NOTHING`, [
      ref.system,
    ]);
    const r = await db.query<{ id: string }>('SELECT id FROM wallets WHERE system_code = $1', [ref.system]);
    const id = r.rows[0]?.id;
    if (!id) throw new AppError('wallet.not_found', 404);
    return id;
  }
  await db.query(
    `INSERT INTO wallets (kind, escrow_key, game_id) VALUES ('escrow', $1, $2) ON CONFLICT (escrow_key) DO NOTHING`,
    [ref.escrow, ref.gameId ?? null],
  );
  const r = await db.query<{ id: string }>('SELECT id FROM wallets WHERE escrow_key = $1', [ref.escrow]);
  const id = r.rows[0]?.id;
  if (!id) throw new AppError('wallet.not_found', 404);
  return id;
}

interface StoredTransfer extends TransferResult {
  kind: string;
  gameId: string | null;
}

async function stored(db: Sql, idempotencyKey: string): Promise<StoredTransfer | null> {
  const tx = await db.query<{ id: string; kind: string; game_id: string | null }>(
    'SELECT id, kind, game_id FROM ledger_transactions WHERE idempotency_key = $1',
    [idempotencyKey],
  );
  const row = tx.rows[0];
  if (!row) return null;
  const entries = await db.query<{ wallet_id: string; amount: number; balance_after: number }>(
    'SELECT wallet_id, amount, balance_after FROM ledger_entries WHERE tx_id = $1',
    [row.id],
  );
  return {
    txId: row.id,
    kind: row.kind,
    gameId: row.game_id,
    replayed: true,
    entries: entries.rows.map((e) => ({ walletId: e.wallet_id, amount: e.amount, balanceAfter: e.balance_after })),
  };
}

/** Mouvement déjà écrit sous cette clé d'idempotence (ou null). */
export async function findTransfer(db: Sql, idempotencyKey: string): Promise<TransferResult | null> {
  const s = await stored(db, idempotencyKey);
  return s === null ? null : { txId: s.txId, replayed: true, entries: s.entries };
}

/** Rejeu : le mouvement existe déjà ; il doit être de même nature, sinon c'est un conflit de clé. */
async function existing(db: Sql, input: TransferInput): Promise<TransferResult | null> {
  const s = await stored(db, input.idempotencyKey);
  if (s === null) return null;
  if (s.kind !== input.kind || s.gameId !== (input.gameId ?? null)) {
    throw new AppError('ledger.idempotency_conflict', 409, { idempotencyKey: input.idempotencyKey });
  }
  return { txId: s.txId, replayed: true, entries: s.entries };
}

/** Écrit un mouvement équilibré et met à jour les soldes. */
export async function transfer(db: Pool | Transaction, input: TransferInput): Promise<TransferResult> {
  validate(input);
  return transaction(db, async (tx) => {
    const already = await existing(tx, input);
    if (already) return already;

    // Portefeuilles d'abord (création éventuelle), puis la ligne de transaction.
    const ids: string[] = [];
    for (const e of input.entries) ids.push(await resolveWallet(tx, e.wallet));
    if (new Set(ids).size !== ids.length) throw new AppError('ledger.invalid_entries', 500, { reason: 'duplicate_wallet' });

    // La clé unique sérialise deux mouvements identiques simultanés : le second attend le premier.
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO ledger_transactions (kind, game_id, idempotency_key, meta)
       VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [input.kind, input.gameId ?? null, input.idempotencyKey, JSON.stringify(input.meta ?? {})],
    );
    const txId = inserted.rows[0]?.id;
    if (!txId) {
      const replay = await existing(tx, input);
      if (replay) return replay;
      throw new Error('mouvement introuvable après conflit de clé');
    }

    // Verrou des portefeuilles, toujours dans le même ordre.
    const locked = await tx.query<{ id: string; kind: string; balance: number }>(
      'SELECT id, kind, balance FROM wallets WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [ids],
    );
    const byId = new Map(locked.rows.map((w) => [w.id, w]));

    const results: TransferResult['entries'] = [];
    input.entries.forEach((e, i) => {
      const id = ids[i];
      const w = id === undefined ? undefined : byId.get(id);
      if (!id || !w) throw new AppError('wallet.not_found', 404);
      const after = w.balance + e.amount;
      if (after < 0 && w.kind !== 'system') {
        throw new AppError('wallet.insufficient_funds', 409, { balance: w.balance, required: -e.amount });
      }
      results.push({ walletId: id, amount: e.amount, balanceAfter: after });
    });

    for (const r of results) {
      await tx.query('INSERT INTO ledger_entries (tx_id, wallet_id, amount, balance_after) VALUES ($1, $2, $3, $4)', [
        txId,
        r.walletId,
        r.amount,
        r.balanceAfter,
      ]);
    }
    // Déclare le mouvement à la base, qui n'accepte un nouveau solde que s'il figure au journal.
    await tx.query(`SELECT set_config('kwatt.ledger_tx', $1, true)`, [txId]);
    for (const r of results) {
      await tx.query('UPDATE wallets SET balance = $2 WHERE id = $1', [r.walletId, r.balanceAfter]);
    }
    return { txId, replayed: false, entries: results };
  });
}

/** Solde d'un joueur (0 s'il n'a pas encore de portefeuille). */
export async function balanceOf(db: Sql, userId: string): Promise<number> {
  const r = await db.query<{ balance: number }>('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
  return r.rows[0]?.balance ?? 0;
}

/** Solde d'un séquestre (0 s'il n'existe pas). */
export async function escrowBalance(db: Sql, escrowKey: string): Promise<number> {
  const r = await db.query<{ balance: number }>('SELECT balance FROM wallets WHERE escrow_key = $1', [escrowKey]);
  return r.rows[0]?.balance ?? 0;
}
