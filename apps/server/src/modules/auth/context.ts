/**
 * Contexte d'authentification d'une requête : vérifié à CHAQUE requête en base (session
 * ouverte, compte non effacé), pour qu'une déconnexion ou un mot de passe changé prenne
 * effet tout de suite, sans attendre l'expiration du jeton d'accès.
 */
import type { AgeGroup, Locale, UserKind } from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { ageBand } from './age.js';
import type { TokenService } from './tokens.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
  deviceId: string;
  kind: UserKind;
  locale: Locale;
  /** null pour un invité. */
  ageGroup: AgeGroup | null;
  /** Adresse e-mail vérifiée (toujours false pour un invité). */
  verified: boolean;
  pseudo: string | null;
}

interface ContextRow {
  user_id: string;
  device_id: string;
  revoked_at: Date | null;
  kind: UserKind;
  locale: Locale;
  birth_year: number | null;
  erased_at: Date | null;
  pseudo: string | null;
  verified: boolean;
}

export async function loadAuthContext(db: Sql, tokens: TokenService, clock: Clock, token: string): Promise<AuthContext> {
  const claims = await tokens.verify(token);
  const r = await db.query<ContextRow>(
    `SELECT s.user_id, s.device_id, s.revoked_at, u.kind, u.locale, u.birth_year, u.erased_at,
            p.pseudo::text AS pseudo, (ai.verified_at IS NOT NULL) AS verified
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'email'
      WHERE s.id = $1`,
    [claims.sessionId],
  );
  const row = r.rows[0];
  if (!row || row.user_id !== claims.userId || row.revoked_at !== null || row.erased_at !== null) {
    throw new AppError('auth.session_revoked', 401);
  }
  let ageGroup: AgeGroup | null = null;
  if (row.kind === 'member' && row.birth_year !== null) {
    const band = ageBand(row.birth_year, clock.now());
    ageGroup = band === 'adult' ? 'adult' : 'teen';
  }
  return {
    userId: row.user_id,
    sessionId: claims.sessionId,
    deviceId: row.device_id,
    // Le compte a pu être converti depuis l'émission du jeton : la base fait foi.
    kind: row.kind,
    locale: row.locale,
    ageGroup,
    verified: row.kind === 'member' && row.verified,
    pseudo: row.pseudo,
  };
}

/** Jeton d'accès lu dans `Authorization: Bearer …`. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}
