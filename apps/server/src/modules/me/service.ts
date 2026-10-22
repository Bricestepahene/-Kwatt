/**
 * Profil minimal et cycle de vie du compte : pseudo (1 fois / 30 jours), langue, réglages,
 * suppression (déconnexion, profil masqué, effacement à J+30, annulable en se reconnectant),
 * export des données, effacement définitif.
 */
import {
  DELETION_GRACE_DAYS,
  ERASED_DISPLAY_NAME,
  PSEUDO_CHANGE_INTERVAL_DAYS,
  SETTINGS_MAX_KEYS,
  type DeleteAccountResponse,
  type ExportResponse,
  type Locale,
  type Me,
  type Settings,
} from '@kwatt/protocol';
import type { FastifyInstance } from 'fastify';
import { PG_UNIQUE_VIOLATION, pgErrorCode, transaction, type Pool } from '../../db/pool.js';
import { DAY, addMs } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { AuthContext } from '../auth/context.js';
import { checkPseudo, isPseudoTaken, suggestPseudos } from '../auth/pseudo.js';
import { revokeSessions } from '../auth/sessions.js';
import { balanceOf, transfer } from '../economy/ledger.js';
import { loadMe } from './me.js';
import type { AccountRegistry } from './registry.js';

export class MeService {
  constructor(private readonly app: FastifyInstance) {}

  private now(): Date {
    return this.app.clock.now();
  }

  me(userId: string): Promise<Me> {
    return loadMe(this.app.db, userId, this.app.clock);
  }

  async changePseudo(auth: AuthContext, pseudo: string): Promise<Me> {
    const problem = checkPseudo(pseudo);
    if (problem === 'invalid') throw new AppError('auth.pseudo_invalid', 400);
    if (problem === 'banned') throw new AppError('auth.pseudo_banned', 400);
    const now = this.now();
    const r = await this.app.db.query<{ pseudo: string; pseudo_changed_at: Date | null }>(
      'SELECT pseudo::text AS pseudo, pseudo_changed_at FROM profiles WHERE user_id = $1',
      [auth.userId],
    );
    const current = r.rows[0];
    if (!current) throw new AppError('auth.member_required', 403);
    if (current.pseudo === pseudo) return this.me(auth.userId);
    if (current.pseudo_changed_at) {
      const next = addMs(current.pseudo_changed_at, PSEUDO_CHANGE_INTERVAL_DAYS * DAY);
      if (next > now) throw new AppError('profile.pseudo_change_too_soon', 409, { nextChangeAt: next.toISOString() });
    }
    if (await isPseudoTaken(this.app.db, pseudo, auth.userId)) {
      throw new AppError('auth.pseudo_taken', 409, { suggestions: await suggestPseudos(this.app.db, pseudo) });
    }
    try {
      await this.app.db.query('UPDATE profiles SET pseudo = $2, pseudo_changed_at = $3 WHERE user_id = $1', [auth.userId, pseudo, now]);
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new AppError('auth.pseudo_taken', 409, { suggestions: await suggestPseudos(this.app.db, pseudo) });
      }
      throw err;
    }
    return this.me(auth.userId);
  }

  async changeLocale(auth: AuthContext, locale: Locale): Promise<Me> {
    await this.app.db.query('UPDATE users SET locale = $2 WHERE id = $1', [auth.userId, locale]);
    return this.me(auth.userId);
  }

  /** Fusionne les réglages ; une valeur null retire la clé. */
  async patchSettings(auth: AuthContext, patch: Settings): Promise<Settings> {
    return transaction(this.app.db, async (tx) => {
      const r = await tx.query<{ settings: Settings }>('SELECT settings FROM profiles WHERE user_id = $1 FOR UPDATE', [auth.userId]);
      const current = r.rows[0];
      if (!current) throw new AppError('auth.member_required', 403);
      const next: Settings = { ...current.settings };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      if (Object.keys(next).length > SETTINGS_MAX_KEYS) throw new AppError('profile.settings_invalid', 400, { maxKeys: SETTINGS_MAX_KEYS });
      await tx.query('UPDATE profiles SET settings = $2 WHERE user_id = $1', [auth.userId, JSON.stringify(next)]);
      return next;
    });
  }

  /**
   * Demande de suppression : toutes les sessions fermées, push coupés, profil masqué,
   * effacement définitif à J+30. Un profil confirme avec son mot de passe.
   */
  async requestDeletion(auth: AuthContext, password: string | undefined): Promise<DeleteAccountResponse> {
    const identity = await this.app.db.query<{ subject: string; password_hash: string | null }>(
      "SELECT subject, password_hash FROM auth_identities WHERE user_id = $1 AND provider = 'email'",
      [auth.userId],
    );
    const id = identity.rows[0];
    if (auth.kind === 'member') {
      if (!id?.password_hash || password === undefined || !(await this.app.passwords.verify(id.password_hash, password))) {
        throw new AppError('auth.wrong_password', 400);
      }
    }
    const now = this.now();
    const scheduledFor = addMs(now, DELETION_GRACE_DAYS * DAY);
    await transaction(
      this.app.db,
      async (tx) => {
        const r = await tx.query(
          'UPDATE users SET delete_requested_at = $2 WHERE id = $1 AND delete_requested_at IS NULL RETURNING id',
          [auth.userId, now],
        );
        if (r.rows.length === 0) throw new AppError('profile.deletion_already_requested', 409);
        await revokeSessions(tx, { userId: auth.userId }, 'account_deleted', now);
        await this.app.notifications.disablePushTokens(tx, auth.userId);
        tx.afterCommit(() => {
          this.app.realtime.closeUser(auth.userId);
          if (id) this.app.mailer.sendDeletionScheduled(id.subject, auth.locale, auth.pseudo ?? '', scheduledFor);
        });
      },
      { log: this.app.log },
    );
    return { deletionScheduledFor: scheduledFor.toISOString() };
  }

  async exportData(auth: AuthContext): Promise<ExportResponse> {
    return {
      format: 'kwatt-export',
      version: 1,
      exportedAt: this.now().toISOString(),
      userId: auth.userId,
      sections: await this.app.accounts.buildExport(this.app.db, auth.userId),
    };
  }
}

/**
 * Efface définitivement les données personnelles d'un compte. Les lignes nécessaires à
 * l'intégrité (users, portefeuille, journal des cauris, parties des autres joueurs) restent,
 * anonymes : pseudo, e-mail, appareils, sessions, notifications, réglages disparaissent ;
 * le nom affiché dans les parties passées devient ERASED_DISPLAY_NAME ; le solde retourne
 * au compte système « house » par une écriture du grand livre.
 */
export async function eraseUser(db: Pool, registry: AccountRegistry, userId: string, now: Date): Promise<void> {
  await transaction(db, async (tx) => {
    const u = await tx.query<{ id: string }>('SELECT id FROM users WHERE id = $1 AND erased_at IS NULL FOR UPDATE', [userId]);
    if (u.rows.length === 0) return;

    await registry.runEraseHooks(tx, userId);

    const balance = await balanceOf(tx, userId);
    if (balance > 0) {
      await transfer(tx, {
        kind: 'account_erased',
        idempotencyKey: `account_erased:${userId}`,
        entries: [
          { wallet: { userId }, amount: -balance },
          { wallet: { system: 'house' }, amount: balance },
        ],
      });
    }

    await tx.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM push_tokens WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM notification_preferences WHERE user_id = $1', [userId]);
    await tx.query(
      'DELETE FROM otp_codes WHERE identity_id IN (SELECT id FROM auth_identities WHERE user_id = $1)',
      [userId],
    );
    await tx.query(
      'DELETE FROM password_reset_tokens WHERE identity_id IN (SELECT id FROM auth_identities WHERE user_id = $1)',
      [userId],
    );
    await tx.query('DELETE FROM auth_identities WHERE user_id = $1', [userId]);
    await tx.query('UPDATE refresh_tokens SET replaced_by = NULL WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM user_devices WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM profiles WHERE user_id = $1', [userId]);
    await tx.query('UPDATE game_players SET display_name = $2 WHERE user_id = $1', [userId, ERASED_DISPLAY_NAME]);
    await tx.query('UPDATE users SET birth_year = NULL, merged_into = NULL, last_seen_at = NULL, erased_at = $2 WHERE id = $1', [
      userId,
      now,
    ]);
  });
}

/** Tâche planifiée : efface les comptes dont la suppression a été demandée il y a 30 jours. */
export async function eraseDueAccounts(db: Pool, registry: AccountRegistry, now: Date, log?: Logger): Promise<number> {
  const due = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE delete_requested_at IS NOT NULL AND erased_at IS NULL AND delete_requested_at <= $1 ORDER BY delete_requested_at LIMIT 500',
    [addMs(now, -DELETION_GRACE_DAYS * DAY)],
  );
  let n = 0;
  for (const row of due.rows) {
    try {
      await eraseUser(db, registry, row.id, now);
      n++;
    } catch (err) {
      log?.error({ err, userId: row.id }, 'effacement du compte en échec');
    }
  }
  if (n > 0) log?.info({ count: n }, 'comptes effacés (J+30)');
  return n;
}
