/**
 * Outils d'administration (support entre amis) : statistiques, recherche d'un compte,
 * année de naissance (changeable seulement par le support, SPEC §6), vérification manuelle
 * de l'adresse (déploiement sans SMTP), ajustement de cauris (par le grand livre),
 * fermeture des sessions, annulation d'une suppression.
 * Utilisés par les routes /v1/admin (ADMIN_TOKEN) et par la CLI (`pnpm --filter @kwatt/server admin …`).
 */
import type { Pool, Sql } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { isPlausibleBirthYear } from '../auth/age.js';
import { revokeSessions } from '../auth/sessions.js';
import { transfer } from '../economy/ledger.js';

export interface AdminStats {
  users: { guests: number; members: number; verified: number; deletionPending: number; erased: number };
  activeSessions: number;
  cauris: { players: number; escrow: number; transactions: number };
  jobs: Array<{ name: string; lastStartedAt: string | null; lastFinishedAt: string | null; lastError: string | null; runCount: number }>;
}

export async function stats(db: Sql): Promise<AdminStats> {
  const u = await db.query<{ guests: number; members: number; verified: number; pending: number; erased: number }>(
    `SELECT count(*) FILTER (WHERE kind = 'guest' AND erased_at IS NULL)::int AS guests,
            count(*) FILTER (WHERE kind = 'member' AND erased_at IS NULL)::int AS members,
            (SELECT count(*)::int FROM auth_identities WHERE verified_at IS NOT NULL) AS verified,
            count(*) FILTER (WHERE delete_requested_at IS NOT NULL AND erased_at IS NULL)::int AS pending,
            count(*) FILTER (WHERE erased_at IS NOT NULL)::int AS erased
       FROM users`,
  );
  const s = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_sessions WHERE revoked_at IS NULL');
  const w = await db.query<{ players: number; escrow: number; transactions: number }>(
    `SELECT COALESCE(sum(balance) FILTER (WHERE kind = 'player'), 0)::bigint AS players,
            COALESCE(sum(balance) FILTER (WHERE kind = 'escrow'), 0)::bigint AS escrow,
            (SELECT count(*)::int FROM ledger_transactions) AS transactions
       FROM wallets`,
  );
  const j = await db.query<{ name: string; last_started_at: Date | null; last_finished_at: Date | null; last_error: string | null; run_count: number }>(
    'SELECT name, last_started_at, last_finished_at, last_error, run_count FROM job_runs ORDER BY name',
  );
  const users = u.rows[0] ?? { guests: 0, members: 0, verified: 0, pending: 0, erased: 0 };
  const wallets = w.rows[0] ?? { players: 0, escrow: 0, transactions: 0 };
  return {
    users: { guests: users.guests, members: users.members, verified: users.verified, deletionPending: users.pending, erased: users.erased },
    activeSessions: s.rows[0]?.n ?? 0,
    cauris: wallets,
    jobs: j.rows.map((r) => ({
      name: r.name,
      lastStartedAt: r.last_started_at?.toISOString() ?? null,
      lastFinishedAt: r.last_finished_at?.toISOString() ?? null,
      lastError: r.last_error,
      runCount: r.run_count,
    })),
  };
}

export interface AdminUser {
  id: string;
  kind: string;
  pseudo: string | null;
  email: string | null;
  emailVerified: boolean;
  birthYear: number | null;
  locale: string;
  balance: number;
  createdAt: string;
  deleteRequestedAt: string | null;
  erasedAt: string | null;
}

/** Recherche par pseudo (début), e-mail (début) ou identifiant exact. */
export async function findUsers(db: Sql, query: string, limit = 20): Promise<AdminUser[]> {
  const q = query.trim();
  const r = await db.query<{
    id: string;
    kind: string;
    pseudo: string | null;
    email: string | null;
    verified_at: Date | null;
    birth_year: number | null;
    locale: string;
    balance: number | null;
    created_at: Date;
    delete_requested_at: Date | null;
    erased_at: Date | null;
  }>(
    `SELECT u.id, u.kind, p.pseudo::text AS pseudo, ai.subject AS email, ai.verified_at, u.birth_year, u.locale,
            w.balance, u.created_at, u.delete_requested_at, u.erased_at
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'email'
       LEFT JOIN wallets w ON w.user_id = u.id
      WHERE u.id::text = $1 OR p.pseudo ILIKE $2 OR ai.subject ILIKE $2
      ORDER BY u.created_at DESC LIMIT $3`,
    [q, `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`, limit],
  );
  return r.rows.map((x) => ({
    id: x.id,
    kind: x.kind,
    pseudo: x.pseudo,
    email: x.email,
    emailVerified: x.verified_at !== null,
    birthYear: x.birth_year,
    locale: x.locale,
    balance: x.balance ?? 0,
    createdAt: x.created_at.toISOString(),
    deleteRequestedAt: x.delete_requested_at?.toISOString() ?? null,
    erasedAt: x.erased_at?.toISOString() ?? null,
  }));
}

/** Identifiant d'un compte à partir d'un pseudo, d'un e-mail ou d'un identifiant exact. */
export async function resolveUserId(db: Sql, who: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `SELECT u.id FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'email'
      WHERE u.id::text = $1 OR p.pseudo = $1::citext OR ai.subject = lower($1)
      LIMIT 2`,
    [who.trim()],
  );
  if (r.rows.length !== 1 || !r.rows[0]) throw new AppError('common.not_found', 404, { who });
  return r.rows[0].id;
}

export async function setBirthYear(db: Sql, userId: string, birthYear: number, now: Date): Promise<void> {
  if (!isPlausibleBirthYear(birthYear, now)) throw new AppError('auth.birth_year_invalid', 400);
  const r = await db.query("UPDATE users SET birth_year = $2 WHERE id = $1 AND kind = 'member' AND erased_at IS NULL RETURNING id", [
    userId,
    birthYear,
  ]);
  if (r.rows.length === 0) throw new AppError('common.not_found', 404);
}

export async function markEmailVerified(db: Sql, userId: string, now: Date): Promise<void> {
  const r = await db.query(
    "UPDATE auth_identities SET verified_at = COALESCE(verified_at, $2) WHERE user_id = $1 AND provider = 'email' RETURNING id",
    [userId, now],
  );
  if (r.rows.length === 0) throw new AppError('common.not_found', 404);
}

/** Ajoute (ou retire) des cauris, contre le compte système « house ». */
export async function adjustBalance(
  db: Pool,
  userId: string,
  amount: number,
  reason: string,
  idempotencyKey: string,
): Promise<{ txId: string; replayed: boolean }> {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new AppError('common.validation', 400, { field: 'amount' });
  const r = await transfer(db, {
    kind: 'admin_adjust',
    idempotencyKey: `admin_adjust:${idempotencyKey}`,
    meta: { reason },
    entries: [
      { wallet: { system: 'house' }, amount: -amount },
      { wallet: { userId }, amount },
    ],
  });
  return { txId: r.txId, replayed: r.replayed };
}

export async function revokeAllSessions(db: Sql, userId: string, now: Date): Promise<string[]> {
  return revokeSessions(db, { userId }, 'admin', now);
}

export async function cancelDeletion(db: Sql, userId: string): Promise<boolean> {
  const r = await db.query(
    'UPDATE users SET delete_requested_at = NULL WHERE id = $1 AND erased_at IS NULL AND delete_requested_at IS NOT NULL RETURNING id',
    [userId],
  );
  return r.rows.length > 0;
}
