/**
 * Codes à 6 chiffres envoyés par e-mail (vérification de l'adresse, mot de passe oublié) :
 * valables 10 minutes, 5 essais, renvoi après 60 s. Seule l'empreinte HMAC est stockée.
 * Un nouveau code annule le précédent.
 */
import { OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_RESEND_SECONDS, OTP_TTL_SECONDS } from '@kwatt/protocol';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import { SECOND, addMs } from '../../lib/clock.js';
import { hmacHex, randomDigits, safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

export type OtpPurpose = 'verify' | 'reset';

function codeHash(secret: string, identityId: string, purpose: OtpPurpose, code: string): string {
  return hmacHex(secret, `otp:${identityId}:${purpose}:${code}`);
}

export interface IssuedOtp {
  code: string;
  expiresAt: Date;
  resendAvailableAt: Date;
}

/** Délai restant avant de pouvoir renvoyer un code (0 si possible maintenant). */
export async function resendWaitSeconds(db: Sql, identityId: string, purpose: OtpPurpose, now: Date): Promise<number> {
  const r = await db.query<{ created_at: Date }>(
    'SELECT created_at FROM otp_codes WHERE identity_id = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1',
    [identityId, purpose],
  );
  const last = r.rows[0]?.created_at;
  if (!last) return 0;
  const wait = last.getTime() + OTP_RESEND_SECONDS * SECOND - now.getTime();
  return wait > 0 ? Math.ceil(wait / SECOND) : 0;
}

/** Crée un nouveau code (lève auth.code_resend_too_soon avant 60 s). */
export async function issueOtp(db: Sql, secret: string, identityId: string, purpose: OtpPurpose, now: Date): Promise<IssuedOtp> {
  const wait = await resendWaitSeconds(db, identityId, purpose, now);
  if (wait > 0) throw new AppError('auth.code_resend_too_soon', 429, { retryAfterSeconds: wait });
  await db.query('UPDATE otp_codes SET used_at = $3 WHERE identity_id = $1 AND purpose = $2 AND used_at IS NULL', [
    identityId,
    purpose,
    now,
  ]);
  const code = randomDigits(OTP_LENGTH);
  const expiresAt = addMs(now, OTP_TTL_SECONDS * SECOND);
  await db.query(
    'INSERT INTO otp_codes (identity_id, purpose, code_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)',
    [identityId, purpose, codeHash(secret, identityId, purpose, code), expiresAt, now],
  );
  return { code, expiresAt, resendAvailableAt: addMs(now, OTP_RESEND_SECONDS * SECOND) };
}

export type OtpCheck = { status: 'ok' } | { status: 'invalid'; attemptsLeft: number } | { status: 'expired' };

/**
 * Vérifie un code. L'essai raté est compté et ENREGISTRÉ (transaction propre) avant que
 * l'appelant ne lève son erreur. Avec une transaction en cours, le code est consommé dedans.
 */
export async function checkOtp(
  db: Pool | Transaction,
  secret: string,
  identityId: string,
  purpose: OtpPurpose,
  code: string,
  now: Date,
): Promise<OtpCheck> {
  return transaction(db, async (tx) => {
    const r = await tx.query<{ id: string; code_hash: string; expires_at: Date; attempts: number }>(
      `SELECT id, code_hash, expires_at, attempts FROM otp_codes
        WHERE identity_id = $1 AND purpose = $2 AND used_at IS NULL
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [identityId, purpose],
    );
    const row = r.rows[0];
    if (!row || row.expires_at.getTime() <= now.getTime() || row.attempts >= OTP_MAX_ATTEMPTS) return { status: 'expired' };
    if (!safeEqual(row.code_hash, codeHash(secret, identityId, purpose, code))) {
      const attempts = row.attempts + 1;
      await tx.query('UPDATE otp_codes SET attempts = $2 WHERE id = $1', [row.id, attempts]);
      return attempts >= OTP_MAX_ATTEMPTS ? { status: 'expired' } : { status: 'invalid', attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
    }
    await tx.query('UPDATE otp_codes SET used_at = $2 WHERE id = $1', [row.id, now]);
    return { status: 'ok' };
  });
}
