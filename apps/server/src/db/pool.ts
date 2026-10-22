/**
 * Accès à PostgreSQL : SQL écrit à la main (pas d'ORM), pool `pg`, transactions.
 *
 * Règle « le serveur fait foi » : on écrit en base AVANT de diffuser. Une transaction offre
 * `afterCommit(fn)` : les envois (WebSocket, push) déclenchés pendant la transaction ne
 * partent qu'une fois l'écriture validée, et jamais si elle est annulée.
 */
import pg from 'pg';
import type { Logger } from '../lib/logger.js';

// bigint (int8) lus comme des nombres : les soldes en cauris restent loin de 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Row = pg.QueryResultRow;

/** Ce qui sait exécuter une requête : le pool ou une transaction. */
export interface Sql {
  query<R extends Row = Row>(text: string, values?: readonly unknown[]): Promise<pg.QueryResult<R>>;
}

export type Pool = pg.Pool;

export function createPool(url: string, max: number, log?: Logger): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000 });
  // Une connexion inactive qui tombe ne doit pas faire planter le processus.
  pool.on('error', (err) => log?.error({ err }, 'connexion PostgreSQL perdue'));
  return pool;
}

/** Transaction en cours : exécute des requêtes et programme des actions après validation. */
export class Transaction implements Sql {
  private readonly hooks: Array<() => void | Promise<void>> = [];

  constructor(readonly client: pg.PoolClient) {}

  query<R extends Row = Row>(text: string, values?: readonly unknown[]): Promise<pg.QueryResult<R>> {
    return this.client.query<R>(text, values as unknown[] | undefined);
  }

  /** Programme `fn` après la validation de la transaction (jamais si elle est annulée). */
  afterCommit(fn: () => void | Promise<void>): void {
    this.hooks.push(fn);
  }

  /** @internal Exécute les actions programmées ; une erreur n'annule plus rien, elle est journalisée. */
  async runAfterCommit(log?: Logger): Promise<void> {
    for (const fn of this.hooks.splice(0)) {
      try {
        await fn();
      } catch (err) {
        log?.error({ err }, 'action après validation en échec');
      }
    }
  }
}

export interface TransactionOptions {
  isolation?: 'read committed' | 'repeatable read' | 'serializable';
  log?: Logger;
}

/**
 * Exécute `fn` dans une transaction. Si `db` est déjà une transaction, `fn` s'y exécute
 * (pas de transaction imbriquée) : les services acceptent ainsi le pool OU une transaction.
 */
export async function transaction<T>(
  db: Pool | Transaction,
  fn: (tx: Transaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  if (db instanceof Transaction) return fn(db);
  const client = await db.connect();
  const tx = new Transaction(client);
  let result: T;
  try {
    await client.query(options.isolation ? `BEGIN ISOLATION LEVEL ${options.isolation.toUpperCase()}` : 'BEGIN');
    result = await fn(tx);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw err;
  }
  client.release();
  await tx.runAfterCommit(options.log);
  return result;
}

/** Exécute `fn` après validation si `db` est une transaction, tout de suite sinon. */
export function afterCommit(db: Sql, fn: () => void | Promise<void>, log?: Logger): void {
  if (db instanceof Transaction) {
    db.afterCommit(fn);
    return;
  }
  Promise.resolve()
    .then(fn)
    .catch((err: unknown) => log?.error({ err }, 'action différée en échec'));
}

/** Code SQLSTATE d'une erreur PostgreSQL, s'il y en a un. */
export function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Nom de la contrainte en cause dans une erreur PostgreSQL. */
export function pgConstraint(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'constraint' in err) {
    const c = (err as { constraint: unknown }).constraint;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';
