/**
 * Sessions et jetons (SPEC §6).
 * - Une session = un compte connecté sur un appareil ; le jeton d'accès porte son identifiant.
 * - Jeton de renouvellement opaque (30 jours), haché en base, TOURNANT : chaque usage en
 *   donne un nouveau et marque l'ancien comme remplacé. Présenter un jeton déjà remplacé
 *   (vol probable) ferme toutes les sessions du compte sur cet appareil.
 */
import type { UserKind } from '@kwatt/protocol';
import { transaction, type Pool, type Sql } from '../../db/pool.js';
import { DAY, addMs, type Clock } from '../../lib/clock.js';
import { hmacHex, randomToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import type { TokenService } from './tokens.js';

export type RevokeReason =
  | 'logout'
  | 'logout_all'
  | 'password_reset'
  | 'password_change'
  | 'refresh_reuse'
  | 'account_deleted'
  | 'guest_converted'
  | 'admin';

export interface SessionDeps {
  clock: Clock;
  tokens: TokenService;
  tokenHashSecret: string;
  refreshTokenTtlDays: number;
}

export interface IssuedTokens {
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export function refreshTokenHash(secret: string, token: string): string {
  return hmacHex(secret, `refresh:${token}`);
}

async function insertRefreshToken(
  db: Sql,
  deps: SessionDeps,
  session: { id: string; userId: string; deviceId: string },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const now = deps.clock.now();
  const token = randomToken();
  const expiresAt = addMs(now, deps.refreshTokenTtlDays * DAY);
  const r = await db.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, device_id, session_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [session.userId, session.deviceId, session.id, refreshTokenHash(deps.tokenHashSecret, token), expiresAt, now],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('jeton de renouvellement non enregistré');
  return { id, token, expiresAt };
}

/** Ouvre une session sur un appareil et rend ses deux jetons. */
export async function openSession(
  db: Sql,
  deps: SessionDeps,
  user: { id: string; kind: UserKind },
  deviceId: string,
): Promise<IssuedTokens> {
  const now = deps.clock.now();
  const s = await db.query<{ id: string }>(
    'INSERT INTO auth_sessions (user_id, device_id, created_at, last_used_at) VALUES ($1, $2, $3, $3) RETURNING id',
    [user.id, deviceId, now],
  );
  const sessionId = s.rows[0]?.id;
  if (!sessionId) throw new Error('session non créée');
  const refresh = await insertRefreshToken(db, deps, { id: sessionId, userId: user.id, deviceId });
  const access = await deps.tokens.sign({ userId: user.id, sessionId, kind: user.kind });
  return {
    sessionId,
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

export interface RevokeFilter {
  userId: string;
  sessionId?: string;
  deviceId?: string;
  exceptSessionId?: string;
}

/** Ferme des sessions ; rend leurs identifiants (pour couper les WebSocket correspondants). */
export async function revokeSessions(db: Sql, filter: RevokeFilter, reason: RevokeReason, now: Date): Promise<string[]> {
  const r = await db.query<{ id: string }>(
    `UPDATE auth_sessions SET revoked_at = $5, revoke_reason = $6
      WHERE user_id = $1 AND revoked_at IS NULL
        AND ($2::uuid IS NULL OR id = $2)
        AND ($3::uuid IS NULL OR device_id = $3)
        AND ($4::uuid IS NULL OR id <> $4)
      RETURNING id`,
    [filter.userId, filter.sessionId ?? null, filter.deviceId ?? null, filter.exceptSessionId ?? null, now, reason],
  );
  return r.rows.map((row) => row.id);
}

export type RefreshOutcome =
  | { status: 'ok'; tokens: IssuedTokens; userId: string; deviceId: string }
  | { status: 'reused'; userId: string; revokedSessionIds: string[] };

interface RefreshRow {
  id: string;
  user_id: string;
  session_id: string | null;
  device_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  session_revoked_at: Date | null;
  install_id: string;
  kind: UserKind;
  erased_at: Date | null;
}

/**
 * Renouvelle les jetons. Une réutilisation est enregistrée (sessions de l'appareil fermées)
 * AVANT que l'erreur auth.refresh_reused ne soit levée par l'appelant.
 */
export async function rotateRefreshToken(
  pool: Pool,
  deps: SessionDeps,
  refreshToken: string,
  installId: string,
): Promise<RefreshOutcome> {
  return transaction(pool, async (tx) => {
    const now = deps.clock.now();
    const r = await tx.query<RefreshRow>(
      `SELECT rt.id, rt.user_id, rt.session_id, rt.device_id, rt.expires_at, rt.revoked_at, rt.replaced_by,
              s.revoked_at AS session_revoked_at, d.install_id, u.kind, u.erased_at
         FROM refresh_tokens rt
         JOIN devices d ON d.id = rt.device_id
         JOIN users u ON u.id = rt.user_id
         LEFT JOIN auth_sessions s ON s.id = rt.session_id
        WHERE rt.token_hash = $1
        FOR UPDATE OF rt`,
      [refreshTokenHash(deps.tokenHashSecret, refreshToken)],
    );
    const row = r.rows[0];
    if (!row || row.session_id === null || row.erased_at !== null) throw new AppError('auth.refresh_invalid', 401);
    if (row.session_revoked_at !== null) throw new AppError('auth.session_revoked', 401);
    if (row.replaced_by !== null || row.revoked_at !== null) {
      const revoked = await revokeSessions(tx, { userId: row.user_id, deviceId: row.device_id }, 'refresh_reuse', now);
      return { status: 'reused', userId: row.user_id, revokedSessionIds: revoked };
    }
    if (row.expires_at.getTime() <= now.getTime()) throw new AppError('auth.refresh_expired', 401);
    if (row.install_id !== installId) throw new AppError('auth.refresh_invalid', 401);

    const next = await insertRefreshToken(tx, deps, { id: row.session_id, userId: row.user_id, deviceId: row.device_id });
    await tx.query('UPDATE refresh_tokens SET replaced_by = $2 WHERE id = $1', [row.id, next.id]);
    await tx.query('UPDATE auth_sessions SET last_used_at = $2 WHERE id = $1', [row.session_id, now]);
    await tx.query('UPDATE devices SET last_seen = $2 WHERE id = $1', [row.device_id, now]);
    await tx.query('UPDATE user_devices SET last_seen_at = $3 WHERE user_id = $1 AND device_id = $2', [
      row.user_id,
      row.device_id,
      now,
    ]);
    const access = await deps.tokens.sign({ userId: row.user_id, sessionId: row.session_id, kind: row.kind });
    return {
      status: 'ok',
      userId: row.user_id,
      deviceId: row.device_id,
      tokens: {
        sessionId: row.session_id,
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: next.token,
        refreshTokenExpiresAt: next.expiresAt,
      },
    };
  });
}
