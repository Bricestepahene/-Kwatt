/**
 * Lecture du profil minimal du joueur connecté (GET /v1/me).
 */
import { DELETION_GRACE_DAYS, PSEUDO_CHANGE_INTERVAL_DAYS, type AgeGroup, type Locale, type Me, type Settings, type UserKind } from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';
import { DAY, addMs, type Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { ageBand, permissionsFor } from '../auth/age.js';

interface MeRow {
  id: string;
  kind: UserKind;
  locale: Locale;
  birth_year: number | null;
  created_at: Date;
  delete_requested_at: Date | null;
  pseudo: string | null;
  pseudo_changed_at: Date | null;
  settings: Settings | null;
  email: string | null;
  verified_at: Date | null;
}

export async function loadMe(db: Sql, userId: string, clock: Clock): Promise<Me> {
  const r = await db.query<MeRow>(
    `SELECT u.id, u.kind, u.locale, u.birth_year, u.created_at, u.delete_requested_at,
            p.pseudo::text AS pseudo, p.pseudo_changed_at, p.settings,
            ai.subject AS email, ai.verified_at
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'email'
      WHERE u.id = $1 AND u.erased_at IS NULL`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) throw new AppError('auth.session_revoked', 401);
  const now = clock.now();
  let ageGroup: AgeGroup | null = null;
  if (row.kind === 'member' && row.birth_year !== null) ageGroup = ageBand(row.birth_year, now) === 'adult' ? 'adult' : 'teen';
  const verified = row.kind === 'member' && row.verified_at !== null;
  const nextPseudoChange = row.pseudo_changed_at ? addMs(row.pseudo_changed_at, PSEUDO_CHANGE_INTERVAL_DAYS * DAY) : null;
  return {
    id: row.id,
    kind: row.kind,
    pseudo: row.pseudo,
    email: row.email,
    emailVerified: verified,
    locale: row.locale,
    ageGroup,
    permissions: permissionsFor(row.kind, ageGroup, verified),
    pseudoChangeAvailableAt: nextPseudoChange && nextPseudoChange > now ? nextPseudoChange.toISOString() : null,
    deletionRequestedAt: row.delete_requested_at ? row.delete_requested_at.toISOString() : null,
    deletionScheduledFor: row.delete_requested_at ? addMs(row.delete_requested_at, DELETION_GRACE_DAYS * DAY).toISOString() : null,
    settings: row.settings ?? {},
    createdAt: row.created_at.toISOString(),
  };
}
