/**
 * Routes du profil (écrans 09 et 10) et de la modération des photos.
 *
 *   GET    /v1/me/profile                     ton profil
 *   GET    /v1/profiles/:userId               profil public (comptes jeunes : visibles des seuls proches)
 *   GET    /v1/me/avatar                      avatar, cadre, mode, photo
 *   PUT    /v1/me/avatar                      { mode?, selection?, frame? }
 *   POST   /v1/me/photo                       multipart, champ « photo »
 *   DELETE /v1/me/photo
 *   GET    /v1/admin/photos?status=pending    (ADMIN_TOKEN)
 *   POST   /v1/admin/photos/:userId/approve   (ADMIN_TOKEN)
 *   POST   /v1/admin/photos/:userId/reject    (ADMIN_TOKEN)
 */
import { PHOTO_ACCEPTED_TYPES, PhotoStatusSchema, ProfileParamsSchema, SaveAvatarRequestSchema } from '@kwatt/protocol';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { bearerToken } from '../auth/context.js';
import { requireAuth } from '../auth/plugin.js';
import { getMyAvatar, saveAvatar } from './avatar.js';
import { deletePhoto, listPhotos, photoDeps, reviewPhoto, uploadPhoto } from './photo.js';
import { loadProfile } from './service.js';

const ACCEPTED: ReadonlySet<string> = new Set(PHOTO_ACCEPTED_TYPES);

/** Erreur de taille levée par @fastify/multipart (fichier au-delà de MEDIA_MAX_BYTES). */
function isFileTooLarge(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'FST_REQ_FILE_TOO_LARGE';
}

const profilesRoutes: FastifyPluginAsync = async (app) => {
  const deps = photoDeps(app);
  // Envois de photo : 10 par minute en production (suit le réglage de l'authentification, relevé en test).
  const photoLimit = { rateLimit: { max: Math.max(10, app.config.rateLimitAuthPerMin * 2), timeWindow: '1 minute' } };

  app.get('/v1/me/profile', { preHandler: app.requireMember }, async (req) => {
    const { userId } = requireAuth(req);
    return loadProfile(app, userId, userId);
  });

  app.get('/v1/profiles/:userId', { preHandler: app.authenticate }, async (req) => {
    const { userId } = parse(ProfileParamsSchema, req.params);
    return loadProfile(app, requireAuth(req).userId, userId);
  });

  app.get('/v1/me/avatar', { preHandler: app.requireMember }, async (req) => getMyAvatar(app.db, app.media, requireAuth(req).userId));

  app.put('/v1/me/avatar', { preHandler: app.requireMember }, async (req) => {
    const body = parse(SaveAvatarRequestSchema, req.body);
    return saveAvatar(app, requireAuth(req).userId, body);
  });

  app.post(
    '/v1/me/photo',
    { preHandler: app.requireMember, config: photoLimit },
    async (req) => {
      const { userId } = requireAuth(req);
      if (!req.isMultipart()) throw new AppError('common.unsupported_media_type', 415);
      const file = await req.file();
      if (!file) throw new AppError('media.missing_file', 400);
      if (!ACCEPTED.has(file.mimetype)) {
        file.file.resume();
        throw new AppError('media.unsupported_type', 415, { accepted: [...PHOTO_ACCEPTED_TYPES] });
      }
      let bytes: Buffer;
      try {
        bytes = await file.toBuffer();
      } catch (err) {
        if (isFileTooLarge(err)) throw new AppError('media.too_large', 413, { maxBytes: app.media.maxBytes });
        throw err;
      }
      return uploadPhoto(deps, userId, bytes);
    },
  );

  app.delete('/v1/me/photo', { preHandler: app.requireMember }, async (req) => deletePhoto(deps, requireAuth(req).userId));

  // Modération (ADMIN_TOKEN, comme /v1/admin du module admin) ----------------------------
  const adminToken = app.config.adminToken;
  if (adminToken) {
    const guard = async (req: FastifyRequest) => {
      const header = req.headers['x-admin-token'];
      const given = bearerToken(req.headers.authorization) ?? (typeof header === 'string' ? header : null);
      if (!given || !safeEqual(given, adminToken)) throw new AppError('common.forbidden', 403);
    };
    const opts = { preHandler: guard, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
    const UserParams = z.object({ userId: z.uuid() });

    app.get('/v1/admin/photos', opts, async (req) => {
      const q = parse(
        z.object({ status: PhotoStatusSchema.default('pending'), limit: z.coerce.number().int().min(1).max(200).default(50) }),
        req.query,
      );
      return { items: await listPhotos(app.db, app.media, q.status, q.limit) };
    });
    app.post('/v1/admin/photos/:userId/approve', opts, async (req) => {
      const { userId } = parse(UserParams, req.params);
      return { ok: true, ...(await reviewPhoto(deps, userId, 'approve')) };
    });
    app.post('/v1/admin/photos/:userId/reject', opts, async (req) => {
      const { userId } = parse(UserParams, req.params);
      return { ok: true, ...(await reviewPhoto(deps, userId, 'reject')) };
    });
  }

  // Effacement à J+30 : la photo disparaît du disque (le profil est supprimé ensuite).
  app.accounts.onErase('photo', async (tx, userId) => {
    const r = await tx.query<{ photo_path: string | null }>('SELECT photo_path FROM profiles WHERE user_id = $1', [userId]);
    const path = r.rows[0]?.photo_path;
    if (path) tx.afterCommit(() => app.media.remove(path));
  });

  // Export des données : l'avatar choisi et l'état de la photo.
  app.accounts.addExportSection('avatar', async (db, userId) => {
    const r = await db.query(
      `SELECT p.avatar_mode AS mode, ip.code AS preset, isk.code AS skin, ih.code AS hat, io.code AS outfit, fr.code AS frame,
              p.photo_status AS "photoStatus", p.photo_url AS "photoUrl", p.photo_uploaded_at AS "photoUploadedAt"
         FROM profiles p
         LEFT JOIN items ip ON ip.id = p.avatar_item_id
         LEFT JOIN items isk ON isk.id = p.avatar_skin_id
         LEFT JOIN items ih ON ih.id = p.avatar_hat_id
         LEFT JOIN items io ON io.id = p.avatar_outfit_id
         LEFT JOIN items fr ON fr.id = p.frame_item_id
        WHERE p.user_id = $1`,
      [userId],
    );
    return r.rows[0] ?? null;
  });
};

export default profilesRoutes;
