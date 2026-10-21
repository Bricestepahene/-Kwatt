/**
 * Routes /v1/me : profil minimal, pseudo, langue, réglages, suppression, export.
 * Enregistre aussi les sections de base de l'export et la tâche d'effacement à J+30.
 */
import {
  ChangeLocaleRequestSchema,
  ChangePseudoRequestSchema,
  DeleteAccountRequestSchema,
  SettingsPatchRequestSchema,
} from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { HOUR } from '../../lib/clock.js';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { balanceOf } from '../economy/ledger.js';
import { fullJournal } from '../economy/service.js';
import { MeService, eraseDueAccounts } from './service.js';

const meRoutes: FastifyPluginAsync = async (app) => {
  const service = new MeService(app);

  app.get('/v1/me', { preHandler: app.authenticate }, async (req) => service.me(requireAuth(req).userId));

  app.patch('/v1/me/pseudo', { preHandler: app.requireMember }, async (req) => {
    const body = parse(ChangePseudoRequestSchema, req.body);
    return service.changePseudo(requireAuth(req), body.pseudo);
  });

  app.patch('/v1/me/locale', { preHandler: app.authenticate }, async (req) => {
    const body = parse(ChangeLocaleRequestSchema, req.body);
    return service.changeLocale(requireAuth(req), body.locale);
  });

  app.get('/v1/me/settings', { preHandler: app.authenticate }, async (req) => {
    const me = await service.me(requireAuth(req).userId);
    return { settings: me.settings };
  });

  app.patch('/v1/me/settings', { preHandler: app.requireMember }, async (req) => {
    const body = parse(SettingsPatchRequestSchema, req.body);
    return { settings: await service.patchSettings(requireAuth(req), body.settings) };
  });

  app.post('/v1/me/delete', { preHandler: app.authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(DeleteAccountRequestSchema, req.body ?? {});
    return service.requestDeletion(requireAuth(req), body.password);
  });

  app.get('/v1/me/export', { preHandler: app.authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const data = await service.exportData(requireAuth(req));
    return reply.header('content-disposition', `attachment; filename="kwatt-export-${data.exportedAt.slice(0, 10)}.json"`).send(data);
  });

  // Effacement définitif à J+30 (toutes les heures).
  app.registerJob('accounts.erase_due', HOUR, async ({ db, now, log }) => {
    await eraseDueAccounts(db, app.accounts, now, log);
  });

  // Purge des codes, jetons et sessions périmés (une fois par jour).
  app.registerJob('auth.purge_expired', 24 * HOUR, async ({ db, now }) => {
    const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR);
    await db.query('DELETE FROM otp_codes WHERE expires_at < $1', [weekAgo]);
    await db.query('DELETE FROM password_reset_tokens WHERE expires_at < $1', [weekAgo]);
    await db.query(
      `DELETE FROM refresh_tokens rt WHERE rt.expires_at < $1
          AND NOT EXISTS (SELECT 1 FROM refresh_tokens x WHERE x.replaced_by = rt.id)`,
      [weekAgo],
    );
  });

  // Sections de base de l'export des données.
  app.accounts.addExportSection('account', async (db, userId) => {
    const r = await db.query(
      `SELECT u.id, u.kind, u.locale, u.birth_year AS "birthYear", u.created_at AS "createdAt",
              u.terms_accepted_at AS "termsAcceptedAt", u.delete_requested_at AS "deleteRequestedAt",
              p.pseudo::text AS pseudo, p.pseudo_changed_at AS "pseudoChangedAt", p.settings,
              p.photo_url AS "photoUrl", p.quarter, ai.subject AS email, ai.verified_at AS "emailVerifiedAt"
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'email'
        WHERE u.id = $1`,
      [userId],
    );
    return r.rows[0] ?? null;
  });
  app.accounts.addExportSection('devices', async (db, userId) => {
    const r = await db.query(
      `SELECT d.platform, d.app_version AS "appVersion", ud.first_seen_at AS "firstSeenAt", ud.last_seen_at AS "lastSeenAt"
         FROM user_devices ud JOIN devices d ON d.id = ud.device_id WHERE ud.user_id = $1 ORDER BY ud.first_seen_at`,
      [userId],
    );
    return r.rows;
  });
  app.accounts.addExportSection('sessions', async (db, userId) => {
    const r = await db.query(
      `SELECT created_at AS "createdAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt", revoke_reason AS "revokeReason"
         FROM auth_sessions WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return r.rows;
  });
  app.accounts.addExportSection('wallet', async (db, userId) => ({
    balance: await balanceOf(db, userId),
    journal: await fullJournal(db, userId),
  }));
  app.accounts.addExportSection('games', async (db, userId) => {
    const r = await db.query(
      `SELECT g.id, g.context, g.variant, g.ranked, g.status, g.end_reason AS "endReason", g.started_at AS "startedAt",
              g.ended_at AS "endedAt", gp.seat, gp.color, gp.place, gp.result
         FROM game_players gp JOIN games g ON g.id = gp.game_id
        WHERE gp.user_id = $1 ORDER BY g.started_at NULLS LAST`,
      [userId],
    );
    return r.rows;
  });
  app.accounts.addExportSection('notifications', async (db, userId) => {
    const r = await db.query(
      'SELECT id, kind, params, created_at AS "createdAt", read_at AS "readAt" FROM notifications WHERE user_id = $1 ORDER BY created_at',
      [userId],
    );
    return r.rows;
  });
};

export default meRoutes;
