/**
 * Apparence d'un joueur (avatar ou photo, cadre), telle qu'un lecteur la voit.
 *
 * Pour les autres modules (sièges d'une partie, amis, classements) :
 *
 *   import { loadLooks } from '../profiles/look.js';
 *   const looks = await loadLooks(app.db, app.media, userIds, viewerId);
 *   looks.get(userId) ?? DEFAULT_LOOK
 *
 * Règles : la photo n'est montrée aux autres qu'une fois approuvée (et si le joueur a choisi
 * le mode photo) ; son titulaire la voit même en vérification. Un compte en cours de
 * suppression, effacé ou invité n'a que l'initiale.
 */
import {
  DEFAULT_LOOK,
  FrameItemRenderSchema,
  HatItemRenderSchema,
  OutfitItemRenderSchema,
  PresetItemRenderSchema,
  SkinItemRenderSchema,
  type AvatarSelection,
  type AvatarView,
  type FrameView,
  type ItemRarity,
  type PhotoState,
  type PhotoStatus,
  type PlayerLook,
} from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';
import type { MediaStore } from '../media/store.js';

export interface LookRow {
  user_id: string;
  avatar_mode: 'avatar' | 'photo';
  photo_path: string | null;
  photo_status: PhotoStatus | null;
  photo_uploaded_at: Date | null;
  photo_reviewed_at: Date | null;
  preset_code: string | null;
  preset_render: unknown;
  skin_code: string | null;
  skin_render: unknown;
  hat_code: string | null;
  hat_render: unknown;
  outfit_code: string | null;
  outfit_render: unknown;
  frame_code: string | null;
  frame_render: unknown;
  frame_rarity: ItemRarity | null;
}

/** Requête de l'apparence (profils visibles : ni effacés, ni en cours de suppression). */
export const LOOK_SELECT = `
  SELECT p.user_id, p.avatar_mode, p.photo_path, p.photo_status, p.photo_uploaded_at, p.photo_reviewed_at,
         ip.code AS preset_code, ip.render AS preset_render,
         isk.code AS skin_code, isk.render AS skin_render,
         ih.code AS hat_code, ih.render AS hat_render,
         io.code AS outfit_code, io.render AS outfit_render,
         fr.code AS frame_code, fr.render AS frame_render, fr.rarity AS frame_rarity
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN items ip ON ip.id = p.avatar_item_id
    LEFT JOIN items isk ON isk.id = p.avatar_skin_id
    LEFT JOIN items ih ON ih.id = p.avatar_hat_id
    LEFT JOIN items io ON io.id = p.avatar_outfit_id
    LEFT JOIN items fr ON fr.id = p.frame_item_id`;

const VISIBLE = 'u.erased_at IS NULL AND u.delete_requested_at IS NULL';

/** Avatar dessiné (sans la photo) à partir des pièces choisies. */
export function avatarFromRow(row: LookRow): AvatarView {
  if (row.preset_code) {
    const r = PresetItemRenderSchema.safeParse(row.preset_render);
    if (r.success) {
      return { kind: 'preset', code: row.preset_code, skin: r.data.skin, hat: r.data.hat, outfit: r.data.outfit, background: r.data.background };
    }
  }
  if (row.skin_code && row.outfit_code) {
    const skin = SkinItemRenderSchema.safeParse(row.skin_render);
    const outfit = OutfitItemRenderSchema.safeParse(row.outfit_render);
    const hat = row.hat_code ? HatItemRenderSchema.safeParse(row.hat_render) : null;
    if (skin.success && outfit.success && (hat === null || hat.success)) {
      return { kind: 'composed', skin: skin.data.tone, hat: hat?.data ?? null, outfit: outfit.data.fabric };
    }
  }
  return { kind: 'initial' };
}

export function frameFromRow(row: LookRow): FrameView | null {
  if (!row.frame_code || !row.frame_rarity) return null;
  const r = FrameItemRenderSchema.safeParse(row.frame_render);
  return r.success ? { code: row.frame_code, fabric: r.data.fabric, rarity: row.frame_rarity } : null;
}

/** La photo se montre-t-elle à ce lecteur ? */
export function photoVisible(row: LookRow, self: boolean): boolean {
  if (row.avatar_mode !== 'photo' || !row.photo_path) return false;
  return row.photo_status === 'approved' || (self && row.photo_status === 'pending');
}

export function lookFromRow(row: LookRow, media: MediaStore, self: boolean): PlayerLook {
  const frame = frameFromRow(row);
  if (photoVisible(row, self) && row.photo_path) return { avatar: { kind: 'photo', url: media.urlOf(row.photo_path) }, frame };
  return { avatar: avatarFromRow(row), frame };
}

export function selectionFromRow(row: LookRow): AvatarSelection {
  if (row.preset_code) return { kind: 'preset', preset: row.preset_code };
  if (row.skin_code && row.outfit_code) return { kind: 'composed', skin: row.skin_code, hat: row.hat_code, outfit: row.outfit_code };
  return { kind: 'initial' };
}

export function photoFromRow(row: LookRow, media: MediaStore): PhotoState | null {
  if (!row.photo_status || !row.photo_uploaded_at) return null;
  return {
    status: row.photo_status,
    url: row.photo_path ? media.urlOf(row.photo_path) : null,
    uploadedAt: row.photo_uploaded_at.toISOString(),
    reviewedAt: row.photo_reviewed_at?.toISOString() ?? null,
  };
}

export async function lookRow(db: Sql, userId: string): Promise<LookRow | null> {
  const r = await db.query<LookRow>(`${LOOK_SELECT} WHERE p.user_id = $1 AND ${VISIBLE}`, [userId]);
  return r.rows[0] ?? null;
}

/**
 * Apparences de plusieurs joueurs, vues par `viewerId` (null : un lecteur quelconque).
 * Les joueurs absents (invités, comptes effacés ou en cours de suppression) n'y sont pas :
 * utiliser DEFAULT_LOOK.
 */
export async function loadLooks(
  db: Sql,
  media: MediaStore,
  userIds: readonly string[],
  viewerId: string | null = null,
): Promise<Map<string, PlayerLook>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const r = await db.query<LookRow>(`${LOOK_SELECT} WHERE p.user_id = ANY($1::uuid[]) AND ${VISIBLE}`, [ids]);
  return new Map(r.rows.map((row) => [row.user_id, lookFromRow(row, media, row.user_id === viewerId)]));
}

export { DEFAULT_LOOK };
