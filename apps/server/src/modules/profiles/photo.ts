/**
 * Photo de profil (écran 10, « Ma photo ») : recadrée au centre en 512×512, convertie en
 * WebP (sharp, métadonnées EXIF retirées), puis modérée avant d'être montrée aux autres
 * (D-10). PHOTO_AUTO_APPROVE=true l'approuve d'office (déploiement entre amis).
 *
 * Modération : GET /v1/admin/photos, POST /v1/admin/photos/:userId/approve|reject, ou la
 * CLI (`admin photos`, `admin photo-approve <joueur>`, `admin photo-reject <joueur>`).
 * Une photo refusée est supprimée ; le joueur est prévenu par une notification.
 */
import { randomUUID } from 'node:crypto';
import { PHOTO_MIN_SIZE, PHOTO_SIZE, type MyAvatar, type PhotoReviewItem, type PhotoStatus } from '@kwatt/protocol';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { transaction, type Pool, type Sql } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { MediaStore } from '../media/store.js';
import type { NotificationService } from '../notifications/service.js';
import { myAvatarFromRow } from './avatar.js';
import { lookRow } from './look.js';

/** Plafond de pixels décodés (photo de 50 Mpx au plus) : protège la mémoire du serveur. */
const MAX_INPUT_PIXELS = 50_000_000;

/** Image envoyée → carré 512×512 WebP, orienté selon l'EXIF, sans métadonnées. */
export async function processPhoto(input: Uint8Array): Promise<Buffer> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
    const meta = await image.metadata();
    const width = meta.autoOrient?.width ?? meta.width;
    const height = meta.autoOrient?.height ?? meta.height;
    if (!width || !height || Math.min(width, height) < PHOTO_MIN_SIZE) {
      throw new AppError('photo.invalid_image', 400, { minSize: PHOTO_MIN_SIZE });
    }
    return await image
      .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('photo.invalid_image', 400, { minSize: PHOTO_MIN_SIZE });
  }
}

export interface PhotoDeps {
  db: Pool;
  media: MediaStore;
  notifications: NotificationService;
  clock: { now(): Date };
  autoApprove: boolean;
  log?: Logger;
}

function txOptions(deps: PhotoDeps): { log?: Logger } {
  return deps.log ? { log: deps.log } : {};
}

export function photoDeps(app: FastifyInstance): PhotoDeps {
  return {
    db: app.db,
    media: app.media,
    notifications: app.notifications,
    clock: app.clock,
    autoApprove: app.config.photoAutoApprove,
    log: app.log,
  };
}

/** Enregistre une nouvelle photo (remplace l'ancienne) et la montre à la place de l'avatar. */
export async function uploadPhoto(deps: PhotoDeps, userId: string, bytes: Uint8Array): Promise<MyAvatar> {
  const webp = await processPhoto(bytes);
  const relPath = `photos/${userId}/${randomUUID()}.webp`;
  const url = await deps.media.save(relPath, webp);
  const now = deps.clock.now();
  const status: PhotoStatus = deps.autoApprove ? 'approved' : 'pending';
  try {
    return await transaction(
      deps.db,
      async (tx) => {
        const old = await tx.query<{ photo_path: string | null }>('SELECT photo_path FROM profiles WHERE user_id = $1 FOR UPDATE', [userId]);
        if (old.rows.length === 0) throw new AppError('auth.member_required', 403);
        await tx.query(
          `UPDATE profiles SET photo_path = $2, photo_url = $3, photo_status = $4, photo_uploaded_at = $5,
                  photo_reviewed_at = $6, avatar_mode = 'photo'
            WHERE user_id = $1`,
          [userId, relPath, url, status, now, deps.autoApprove ? now : null],
        );
        const previous = old.rows[0]?.photo_path;
        if (previous && previous !== relPath) tx.afterCommit(() => deps.media.remove(previous));
        const row = await lookRow(tx, userId);
        if (!row) throw new AppError('auth.member_required', 403);
        return myAvatarFromRow(row, deps.media);
      },
      txOptions(deps),
    );
  } catch (err) {
    await deps.media.remove(relPath).catch(() => undefined);
    throw err;
  }
}

/** Supprime la photo : l'avatar reprend sa place. */
export async function deletePhoto(deps: PhotoDeps, userId: string): Promise<MyAvatar> {
  return transaction(
    deps.db,
    async (tx) => {
      const old = await tx.query<{ photo_path: string | null }>('SELECT photo_path FROM profiles WHERE user_id = $1 FOR UPDATE', [userId]);
      if (old.rows.length === 0) throw new AppError('auth.member_required', 403);
      await tx.query(
        `UPDATE profiles SET photo_path = NULL, photo_url = NULL, photo_status = NULL, photo_uploaded_at = NULL,
                photo_reviewed_at = NULL, avatar_mode = 'avatar'
          WHERE user_id = $1`,
        [userId],
      );
      const previous = old.rows[0]?.photo_path;
      if (previous) tx.afterCommit(() => deps.media.remove(previous));
      const row = await lookRow(tx, userId);
      if (!row) throw new AppError('auth.member_required', 403);
      return myAvatarFromRow(row, deps.media);
    },
    txOptions(deps),
  );
}

/** Photos à modérer (les plus anciennes d'abord), ou déjà modérées. */
export async function listPhotos(db: Sql, media: MediaStore, status: PhotoStatus = 'pending', limit = 50): Promise<PhotoReviewItem[]> {
  const r = await db.query<{
    user_id: string;
    pseudo: string;
    photo_status: PhotoStatus;
    photo_path: string | null;
    photo_uploaded_at: Date;
    photo_reviewed_at: Date | null;
  }>(
    `SELECT p.user_id, p.pseudo::text AS pseudo, p.photo_status, p.photo_path, p.photo_uploaded_at, p.photo_reviewed_at
       FROM profiles p JOIN users u ON u.id = p.user_id
      WHERE p.photo_status = $1 AND p.photo_uploaded_at IS NOT NULL AND u.erased_at IS NULL
      ORDER BY p.photo_uploaded_at ${status === 'pending' ? 'ASC' : 'DESC'}
      LIMIT $2`,
    [status, limit],
  );
  return r.rows.map((row) => ({
    userId: row.user_id,
    pseudo: row.pseudo,
    status: row.photo_status,
    url: row.photo_path ? media.urlOf(row.photo_path) : null,
    uploadedAt: row.photo_uploaded_at.toISOString(),
    reviewedAt: row.photo_reviewed_at?.toISOString() ?? null,
  }));
}

/**
 * Décision de modération. Approuver : la photo devient visible de tous (si le joueur l'a
 * choisie). Refuser : le fichier est supprimé, l'avatar reprend sa place.
 */
export async function reviewPhoto(deps: PhotoDeps, userId: string, decision: 'approve' | 'reject'): Promise<{ status: PhotoStatus }> {
  const now = deps.clock.now();
  return transaction(
    deps.db,
    async (tx) => {
      const r = await tx.query<{ photo_path: string | null; photo_status: PhotoStatus | null }>(
        'SELECT photo_path, photo_status FROM profiles WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      const row = r.rows[0];
      if (!row?.photo_path) throw new AppError('photo.not_found', 404);
      if (decision === 'approve') {
        if (row.photo_status !== 'approved') {
          await tx.query(`UPDATE profiles SET photo_status = 'approved', photo_reviewed_at = $2 WHERE user_id = $1`, [userId, now]);
          await deps.notifications.notify(tx, userId, 'profile.photo_approved', {});
        }
        return { status: 'approved' };
      }
      await tx.query(
        `UPDATE profiles SET photo_status = 'rejected', photo_path = NULL, photo_url = NULL, photo_reviewed_at = $2,
                avatar_mode = 'avatar'
          WHERE user_id = $1`,
        [userId, now],
      );
      await deps.notifications.notify(tx, userId, 'profile.photo_rejected', {});
      const path = row.photo_path;
      tx.afterCommit(() => deps.media.remove(path));
      return { status: 'rejected' };
    },
    txOptions(deps),
  );
}
