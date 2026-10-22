/**
 * Comptes et connexion (SPEC §6) : inscription, vérification de l'adresse, connexion,
 * invité, conversion invité → profil, renouvellement, déconnexion, mot de passe oublié,
 * changement de mot de passe, disponibilité du pseudo.
 */
import {
  DEFAULT_LOCALE,
  PASSWORD_MIN_LENGTH,
  type AuthSessionResponse,
  type Device,
  type Locale,
  type LoginResponse,
  type Me,
  type PseudoAvailabilityResponse,
  type RegisterRequest,
  type RegisterResponse,
  type ResendCodeResponse,
  type ResetVerifyResponse,
} from '@kwatt/protocol';
import type { FastifyInstance } from 'fastify';
import { PG_UNIQUE_VIOLATION, pgConstraint, pgErrorCode, transaction } from '../../db/pool.js';
import { MINUTE, addMs } from '../../lib/clock.js';
import { hmacHex, randomToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { KeyedRateLimiter } from '../../lib/rate-limiter.js';
import { grantWelcomeBonus } from '../economy/service.js';
import { loadMe } from '../me/me.js';
import { ageBand, isPlausibleBirthYear } from './age.js';
import type { AuthContext } from './context.js';
import { linkUserDevice, touchDevice, upsertDevice } from './devices.js';
import { checkOtp, issueOtp } from './otp.js';
import { checkPseudo, isPseudoTaken, suggestPseudos } from './pseudo.js';
import { openSession, revokeSessions, rotateRefreshToken, type IssuedTokens, type SessionDeps } from './sessions.js';

const RESET_TOKEN_TTL_MS = 15 * MINUTE;

class PseudoTaken extends Error {}

function sessionResponse(tokens: IssuedTokens, me: Me): AuthSessionResponse {
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
    me,
  };
}

function assertPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) throw new AppError('auth.password_too_short', 400, { min: PASSWORD_MIN_LENGTH });
}

function assertPseudo(pseudo: string): void {
  const problem = checkPseudo(pseudo);
  if (problem === 'invalid') throw new AppError('auth.pseudo_invalid', 400);
  if (problem === 'banned') throw new AppError('auth.pseudo_banned', 400);
}

export class AuthService {
  /** 5 essais de connexion par minute et par compte (la limite par IP est posée sur la route). */
  private readonly loginLimiter;
  /** « Mot de passe oublié » : 3 demandes par adresse et par 10 minutes (au-delà : rien n'est envoyé). */
  private readonly forgotLimiter;
  /** Validation du code de réinitialisation : 5 essais par adresse, que le compte existe ou non. */
  private readonly resetLimiter;
  private readonly sessionDeps: SessionDeps;

  constructor(private readonly app: FastifyInstance) {
    const { clock, config } = app;
    this.loginLimiter = new KeyedRateLimiter(config.rateLimitAuthPerMin, MINUTE, clock);
    this.forgotLimiter = new KeyedRateLimiter(3, 10 * MINUTE, clock);
    this.resetLimiter = new KeyedRateLimiter(5, 10 * MINUTE, clock);
    this.sessionDeps = {
      clock,
      tokens: app.tokens,
      tokenHashSecret: config.tokenHashSecret,
      refreshTokenTtlDays: config.refreshTokenTtlDays,
    };
  }

  private now(): Date {
    return this.app.clock.now();
  }

  /** Coupe les WebSocket des sessions fermées. */
  private closeSockets(sessionIds: string[]): void {
    for (const id of sessionIds) this.app.realtime.closeSession(id);
  }

  // --- Inscription -------------------------------------------------------------------

  /**
   * Crée un profil. Avec le jeton d'un invité, le compte invité est CONVERTI (même users.id,
   * ses parties sont gardées) et ses sessions d'invité sont fermées.
   */
  async register(input: RegisterRequest, current: AuthContext | null): Promise<RegisterResponse> {
    const now = this.now();
    if (!input.acceptTerms) throw new AppError('auth.consent_required', 400);
    assertPassword(input.password);
    assertPseudo(input.pseudo);
    if (!isPlausibleBirthYear(input.birthYear, now)) throw new AppError('auth.birth_year_invalid', 400);
    if (ageBand(input.birthYear, now) === 'child') throw new AppError('auth.too_young', 403);

    const passwordHash = await this.app.passwords.hash(input.password);
    const guest = current?.kind === 'guest' ? current : null;
    const locale: Locale = input.locale ?? guest?.locale ?? DEFAULT_LOCALE;

    let created: { userId: string; tokens: IssuedTokens; bonus: number; converted: boolean };
    try {
      created = await transaction(
        this.app.db,
        async (tx) => {
          const emailUsed = await tx.query("SELECT 1 FROM auth_identities WHERE provider = 'email' AND subject = $1", [input.email]);
          if (emailUsed.rows.length > 0) throw new AppError('auth.email_taken', 409);
          if (await isPseudoTaken(tx, input.pseudo)) throw new PseudoTaken();

          let userId: string | null = null;
          if (guest) {
            const u = await tx.query<{ kind: string }>('SELECT kind FROM users WHERE id = $1 AND erased_at IS NULL FOR UPDATE', [
              guest.userId,
            ]);
            if (u.rows[0]?.kind === 'guest') {
              await tx.query(
                `UPDATE users SET kind = 'member', birth_year = $2, locale = $3, terms_accepted_at = $4, delete_requested_at = NULL
                  WHERE id = $1`,
                [guest.userId, input.birthYear, locale, now],
              );
              userId = guest.userId;
            }
          }
          const converted = userId !== null;
          if (userId === null) {
            const u = await tx.query<{ id: string }>(
              `INSERT INTO users (kind, birth_year, locale, terms_accepted_at, created_at)
               VALUES ('member', $1, $2, $3, $3) RETURNING id`,
              [input.birthYear, locale, now],
            );
            userId = u.rows[0]?.id ?? null;
            if (userId === null) throw new Error('compte non créé');
          }
          await tx.query('INSERT INTO profiles (user_id, pseudo, created_at) VALUES ($1, $2, $3)', [userId, input.pseudo, now]);
          const identity = await tx.query<{ id: string }>(
            `INSERT INTO auth_identities (user_id, provider, subject, password_hash) VALUES ($1, 'email', $2, $3) RETURNING id`,
            [userId, input.email, passwordHash],
          );
          const identityId = identity.rows[0]?.id;
          if (!identityId) throw new Error('identité non créée');

          const deviceId = await touchDevice(tx, userId, input.device, now);
          if (converted) {
            const revoked = await revokeSessions(tx, { userId }, 'guest_converted', now);
            tx.afterCommit(() => this.closeSockets(revoked));
          }
          const tokens = await openSession(tx, this.sessionDeps, { id: userId, kind: 'member' }, deviceId);
          const bonus = await grantWelcomeBonus(tx, userId);
          const otp = await issueOtp(tx, this.app.config.tokenHashSecret, identityId, 'verify', now);
          tx.afterCommit(() => this.app.mailer.sendVerificationCode(input.email, locale, otp.code, input.pseudo));
          return { userId, tokens, bonus, converted };
        },
        { log: this.app.log },
      );
    } catch (err) {
      const constraint = pgErrorCode(err) === PG_UNIQUE_VIOLATION ? pgConstraint(err) : undefined;
      if (constraint === 'auth_identities_provider_subject_key') throw new AppError('auth.email_taken', 409);
      if (err instanceof PseudoTaken || constraint === 'profiles_pseudo_key') {
        throw new AppError('auth.pseudo_taken', 409, { suggestions: await suggestPseudos(this.app.db, input.pseudo) });
      }
      throw err;
    }

    const me = await loadMe(this.app.db, created.userId, this.app.clock);
    return { ...sessionResponse(created.tokens, me), converted: created.converted, welcomeBonus: created.bonus };
  }

  // --- Connexion -----------------------------------------------------------------------

  /** Connexion par pseudo OU e-mail. Se reconnecter annule une suppression demandée. */
  async login(login: string, password: string, device: Device): Promise<LoginResponse> {
    const key = `login:${login.trim().toLowerCase()}`;
    this.loginLimiter.hit(key);
    const isEmail = login.includes('@');
    const r = await this.app.db.query<{ user_id: string; password_hash: string | null }>(
      isEmail
        ? `SELECT ai.user_id, ai.password_hash FROM auth_identities ai JOIN users u ON u.id = ai.user_id
            WHERE ai.provider = 'email' AND ai.subject = $1 AND u.erased_at IS NULL`
        : `SELECT ai.user_id, ai.password_hash FROM profiles p
             JOIN users u ON u.id = p.user_id
             JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'email'
            WHERE p.pseudo = $1::citext AND u.erased_at IS NULL`,
      [isEmail ? login.trim().toLowerCase() : login.trim()],
    );
    const row = r.rows[0];
    // Limite aussi par compte : alterner pseudo et e-mail du même compte ne double pas les essais.
    const accountKey = row ? `login-user:${row.user_id}` : null;
    if (accountKey) this.loginLimiter.hit(accountKey);
    const ok = row?.password_hash ? await this.app.passwords.verify(row.password_hash, password) : await this.app.passwords.verifyDummy(password);
    if (!row || !ok) throw new AppError('auth.invalid_credentials', 401);
    this.loginLimiter.reset(key);
    if (accountKey) this.loginLimiter.reset(accountKey);

    const now = this.now();
    const result = await transaction(this.app.db, async (tx) => {
      const deviceId = await touchDevice(tx, row.user_id, device, now);
      const cancelled = await tx.query(
        'UPDATE users SET delete_requested_at = NULL WHERE id = $1 AND delete_requested_at IS NOT NULL RETURNING id',
        [row.user_id],
      );
      const tokens = await openSession(tx, this.sessionDeps, { id: row.user_id, kind: 'member' }, deviceId);
      return { tokens, deletionCancelled: cancelled.rows.length > 0 };
    });
    const me = await loadMe(this.app.db, row.user_id, this.app.clock);
    return { ...sessionResponse(result.tokens, me), deletionCancelled: result.deletionCancelled };
  }

  /**
   * Compte invité lié à l'appareil (jouer avec un code, regarder, ligue privée gratuite).
   * L'invité est attaché à l'identifiant d'installation : si l'appareil a déjà un compte
   * invité actif (jetons perdus, renouvellement expiré), on le reprend avec ses parties ;
   * sinon on en crée un. `created` dit lequel des deux.
   */
  async guest(device: Device, locale: Locale | undefined): Promise<AuthSessionResponse & { created: boolean }> {
    const now = this.now();
    const result = await transaction(this.app.db, async (tx) => {
      // L'upsert verrouille la ligne de l'appareil jusqu'à la fin de la transaction : deux
      // demandes simultanées du même appareil ne créent pas deux invités.
      const deviceId = await upsertDevice(tx, device, now);
      const existing = await tx.query<{ id: string }>(
        `SELECT u.id FROM user_devices ud JOIN users u ON u.id = ud.user_id
          WHERE ud.device_id = $1 AND u.kind = 'guest' AND u.erased_at IS NULL
            AND u.delete_requested_at IS NULL AND u.merged_into IS NULL
          ORDER BY ud.last_seen_at DESC LIMIT 1`,
        [deviceId],
      );
      let userId = existing.rows[0]?.id ?? null;
      const created = userId === null;
      if (userId === null) {
        const u = await tx.query<{ id: string }>(
          "INSERT INTO users (kind, locale, created_at) VALUES ('guest', $1, $2) RETURNING id",
          [locale ?? DEFAULT_LOCALE, now],
        );
        userId = u.rows[0]?.id ?? null;
        if (userId === null) throw new Error('invité non créé');
      } else if (locale !== undefined) {
        await tx.query('UPDATE users SET locale = $2 WHERE id = $1', [userId, locale]);
      }
      await linkUserDevice(tx, userId, deviceId, now);
      const tokens = await openSession(tx, this.sessionDeps, { id: userId, kind: 'guest' }, deviceId);
      return { userId, tokens, created };
    });
    return {
      ...sessionResponse(result.tokens, await loadMe(this.app.db, result.userId, this.app.clock)),
      created: result.created,
    };
  }

  /** Nouveau couple de jetons ; un ancien jeton réutilisé ferme les sessions de l'appareil. */
  async refresh(refreshToken: string, device: Device): Promise<AuthSessionResponse> {
    const outcome = await rotateRefreshToken(this.app.db, this.sessionDeps, refreshToken, device.installId);
    if (outcome.status === 'reused') {
      this.closeSockets(outcome.revokedSessionIds);
      this.app.log.warn({ userId: outcome.userId }, 'jeton de renouvellement réutilisé : sessions de l\'appareil fermées');
      throw new AppError('auth.refresh_reused', 401);
    }
    await upsertDevice(this.app.db, device, this.now());
    return sessionResponse(outcome.tokens, await loadMe(this.app.db, outcome.userId, this.app.clock));
  }

  async logout(auth: AuthContext): Promise<void> {
    const revoked = await revokeSessions(this.app.db, { userId: auth.userId, sessionId: auth.sessionId }, 'logout', this.now());
    await this.app.notifications.disablePushTokens(this.app.db, auth.userId, auth.deviceId);
    this.closeSockets(revoked);
  }

  async logoutAll(auth: AuthContext): Promise<void> {
    const revoked = await revokeSessions(this.app.db, { userId: auth.userId }, 'logout_all', this.now());
    await this.app.notifications.disablePushTokens(this.app.db, auth.userId);
    this.closeSockets(revoked);
    this.app.realtime.closeUser(auth.userId);
  }

  // --- Vérification de l'adresse -----------------------------------------------------------

  private async emailIdentity(userId: string): Promise<{ id: string; subject: string; verified_at: Date | null; password_hash: string | null }> {
    const r = await this.app.db.query<{ id: string; subject: string; verified_at: Date | null; password_hash: string | null }>(
      "SELECT id, subject, verified_at, password_hash FROM auth_identities WHERE user_id = $1 AND provider = 'email'",
      [userId],
    );
    const row = r.rows[0];
    if (!row) throw new AppError('auth.member_required', 403);
    return row;
  }

  async verifyEmail(auth: AuthContext, code: string): Promise<Me> {
    const identity = await this.emailIdentity(auth.userId);
    if (identity.verified_at) throw new AppError('auth.already_verified', 409);
    const now = this.now();
    const check = await checkOtp(this.app.db, this.app.config.tokenHashSecret, identity.id, 'verify', code, now);
    if (check.status === 'invalid') throw new AppError('auth.code_invalid', 400, { attemptsLeft: check.attemptsLeft });
    if (check.status === 'expired') throw new AppError('auth.code_expired', 400);
    await this.app.db.query('UPDATE auth_identities SET verified_at = $2 WHERE id = $1', [identity.id, now]);
    return loadMe(this.app.db, auth.userId, this.app.clock);
  }

  async resendVerification(auth: AuthContext): Promise<ResendCodeResponse> {
    const identity = await this.emailIdentity(auth.userId);
    if (identity.verified_at) throw new AppError('auth.already_verified', 409);
    const otp = await issueOtp(this.app.db, this.app.config.tokenHashSecret, identity.id, 'verify', this.now());
    this.app.mailer.sendVerificationCode(identity.subject, auth.locale, otp.code, auth.pseudo ?? '');
    return { resendAvailableAt: otp.resendAvailableAt.toISOString(), expiresAt: otp.expiresAt.toISOString() };
  }

  // --- Mot de passe oublié ------------------------------------------------------------------

  /** Envoie un code si le compte existe. La réponse est la même dans tous les cas. */
  async forgotPassword(email: string): Promise<void> {
    try {
      this.forgotLimiter.hit(`forgot:${email}`);
    } catch {
      return;
    }
    this.resetLimiter.reset(`reset:${email}`);
    const r = await this.app.db.query<{ id: string; locale: Locale }>(
      `SELECT ai.id, u.locale FROM auth_identities ai JOIN users u ON u.id = ai.user_id
        WHERE ai.provider = 'email' AND ai.subject = $1 AND u.erased_at IS NULL`,
      [email],
    );
    const identity = r.rows[0];
    if (!identity) return;
    try {
      const otp = await issueOtp(this.app.db, this.app.config.tokenHashSecret, identity.id, 'reset', this.now());
      this.app.mailer.sendResetCode(email, identity.locale, otp.code);
    } catch (err) {
      if (err instanceof AppError && err.code === 'auth.code_resend_too_soon') return;
      throw err;
    }
  }

  /**
   * Étape 2 : le code contre un jeton de réinitialisation. Sans rien révéler : compte
   * inconnu, code faux ou expiré donnent tous auth.code_invalid ; 5 essais par adresse.
   */
  async verifyResetCode(email: string, code: string): Promise<ResetVerifyResponse> {
    const key = `reset:${email}`;
    this.resetLimiter.hit(key);
    const r = await this.app.db.query<{ id: string }>(
      `SELECT ai.id FROM auth_identities ai JOIN users u ON u.id = ai.user_id
        WHERE ai.provider = 'email' AND ai.subject = $1 AND u.erased_at IS NULL`,
      [email],
    );
    const identity = r.rows[0];
    if (!identity) throw new AppError('auth.code_invalid', 400);
    const now = this.now();
    const check = await checkOtp(this.app.db, this.app.config.tokenHashSecret, identity.id, 'reset', code, now);
    if (check.status !== 'ok') throw new AppError('auth.code_invalid', 400);
    this.resetLimiter.reset(key);

    const token = randomToken();
    const expiresAt = addMs(now, RESET_TOKEN_TTL_MS);
    await transaction(this.app.db, async (tx) => {
      await tx.query('UPDATE password_reset_tokens SET used_at = $2 WHERE identity_id = $1 AND used_at IS NULL', [identity.id, now]);
      await tx.query(
        'INSERT INTO password_reset_tokens (identity_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)',
        [identity.id, hmacHex(this.app.config.tokenHashSecret, `reset:${token}`), expiresAt, now],
      );
    });
    return { resetToken: token, expiresAt: expiresAt.toISOString() };
  }

  /** Étape 3 : nouveau mot de passe ; toutes les sessions sont fermées, cet appareil est connecté. */
  async resetPassword(resetToken: string, newPassword: string, device: Device): Promise<AuthSessionResponse> {
    assertPassword(newPassword);
    const passwordHash = await this.app.passwords.hash(newPassword);
    const now = this.now();
    const result = await transaction(
      this.app.db,
      async (tx) => {
        const r = await tx.query<{ id: string; identity_id: string; user_id: string; subject: string; locale: Locale; pseudo: string | null }>(
          `SELECT prt.id, prt.identity_id, ai.user_id, ai.subject, u.locale, p.pseudo::text AS pseudo
             FROM password_reset_tokens prt
             JOIN auth_identities ai ON ai.id = prt.identity_id
             JOIN users u ON u.id = ai.user_id
             LEFT JOIN profiles p ON p.user_id = u.id
            WHERE prt.token_hash = $1 AND prt.used_at IS NULL AND prt.expires_at > $2 AND u.erased_at IS NULL
            FOR UPDATE OF prt`,
          [hmacHex(this.app.config.tokenHashSecret, `reset:${resetToken}`), now],
        );
        const row = r.rows[0];
        if (!row) throw new AppError('auth.reset_token_invalid', 400);
        await tx.query('UPDATE password_reset_tokens SET used_at = $2 WHERE id = $1', [row.id, now]);
        // Le code reçu par e-mail prouve aussi que l'adresse appartient au joueur.
        await tx.query('UPDATE auth_identities SET password_hash = $2, verified_at = COALESCE(verified_at, $3) WHERE id = $1', [
          row.identity_id,
          passwordHash,
          now,
        ]);
        await tx.query('UPDATE users SET delete_requested_at = NULL WHERE id = $1', [row.user_id]);
        const revoked = await revokeSessions(tx, { userId: row.user_id }, 'password_reset', now);
        tx.afterCommit(() => {
          this.closeSockets(revoked);
          this.app.mailer.sendPasswordChanged(row.subject, row.locale, row.pseudo ?? '');
        });
        const deviceId = await touchDevice(tx, row.user_id, device, now);
        const tokens = await openSession(tx, this.sessionDeps, { id: row.user_id, kind: 'member' }, deviceId);
        return { userId: row.user_id, tokens };
      },
      { log: this.app.log },
    );
    return sessionResponse(result.tokens, await loadMe(this.app.db, result.userId, this.app.clock));
  }

  /** Changement de mot de passe : les AUTRES sessions sont fermées, celle-ci reste ouverte. */
  async changePassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
    assertPassword(newPassword);
    this.loginLimiter.hit(`password:${auth.userId}`);
    const identity = await this.emailIdentity(auth.userId);
    if (!identity.password_hash || !(await this.app.passwords.verify(identity.password_hash, currentPassword))) {
      throw new AppError('auth.wrong_password', 400);
    }
    this.loginLimiter.reset(`password:${auth.userId}`);
    const passwordHash = await this.app.passwords.hash(newPassword);
    const now = this.now();
    await transaction(
      this.app.db,
      async (tx) => {
        await tx.query('UPDATE auth_identities SET password_hash = $2 WHERE id = $1', [identity.id, passwordHash]);
        const revoked = await revokeSessions(tx, { userId: auth.userId, exceptSessionId: auth.sessionId }, 'password_change', now);
        tx.afterCommit(() => {
          this.closeSockets(revoked);
          this.app.mailer.sendPasswordChanged(identity.subject, auth.locale, auth.pseudo ?? '');
        });
      },
      { log: this.app.log },
    );
  }

  // --- Pseudo -----------------------------------------------------------------------------

  async pseudoAvailability(pseudo: string): Promise<PseudoAvailabilityResponse> {
    const problem = checkPseudo(pseudo);
    if (problem === 'banned') return { pseudo, available: false, reason: 'banned', suggestions: [] };
    if (problem === 'invalid') {
      return { pseudo, available: false, reason: 'invalid', suggestions: await suggestPseudos(this.app.db, pseudo) };
    }
    if (await isPseudoTaken(this.app.db, pseudo)) {
      return { pseudo, available: false, reason: 'taken', suggestions: await suggestPseudos(this.app.db, pseudo) };
    }
    return { pseudo, available: true, reason: null, suggestions: [] };
  }
}
