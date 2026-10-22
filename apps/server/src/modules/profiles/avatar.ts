/**
 * Avatar du Studio (écran 10) : avatar composé (teint, coiffe, tenue) ou avatar prêt, cadre
 * de tissu, et choix de l'image montrée aux autres (avatar ou photo). Les pièces non
 * possédées s'essaient dans l'appli, mais l'enregistrement les refuse (409 avatar.not_owned,
 * avec le prix total des pièces achetables) : l'appli propose alors « Acheter · X cauris ».
 */
import type { AvatarSelection, ItemKind, MyAvatar, SaveAvatarRequest } from '@kwatt/protocol';
import type { FastifyInstance } from 'fastify';
import { transaction, type Sql } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import type { MediaStore } from '../media/store.js';
import { bestRankOf, isLocked, isOwned, isSoldOut, itemsByCodes, ownedRows, type ItemRow } from '../shop/catalog.js';
import { lookFromRow, lookRow, photoFromRow, selectionFromRow, type LookRow } from './look.js';

export function myAvatarFromRow(row: LookRow, media: MediaStore): MyAvatar {
  return {
    mode: row.avatar_mode,
    selection: selectionFromRow(row),
    frame: row.frame_code,
    photo: photoFromRow(row, media),
    look: lookFromRow(row, media, false),
    ownLook: lookFromRow(row, media, true),
  };
}

export async function getMyAvatar(db: Sql, media: MediaStore, userId: string): Promise<MyAvatar> {
  const row = await lookRow(db, userId);
  if (!row) throw new AppError('auth.member_required', 403);
  return myAvatarFromRow(row, media);
}

interface Slot {
  slot: 'skin' | 'hat' | 'outfit' | 'preset' | 'frame';
  kind: ItemKind;
  code: string;
}

function slotsOf(selection: AvatarSelection | undefined, frame: string | null | undefined): Slot[] {
  const slots: Slot[] = [];
  if (selection?.kind === 'composed') {
    slots.push({ slot: 'skin', kind: 'avatar_skin', code: selection.skin });
    if (selection.hat !== null) slots.push({ slot: 'hat', kind: 'avatar_hat', code: selection.hat });
    slots.push({ slot: 'outfit', kind: 'avatar_outfit', code: selection.outfit });
  } else if (selection?.kind === 'preset') {
    slots.push({ slot: 'preset', kind: 'avatar_preset', code: selection.preset });
  }
  if (typeof frame === 'string') slots.push({ slot: 'frame', kind: 'frame', code: frame });
  return slots;
}

/** Enregistre l'avatar, le cadre et le mode ; champs absents inchangés. */
export async function saveAvatar(app: FastifyInstance, userId: string, req: SaveAvatarRequest): Promise<MyAvatar> {
  return transaction(app.db, async (tx) => {
    const current = await tx.query<{ photo_path: string | null }>('SELECT photo_path FROM profiles WHERE user_id = $1 FOR UPDATE', [
      userId,
    ]);
    if (current.rows.length === 0) throw new AppError('auth.member_required', 403);

    const slots = slotsOf(req.selection, req.frame);
    const items = await itemsByCodes(
      tx,
      slots.map((s) => s.code),
    );
    for (const s of slots) {
      const item = items.get(s.code);
      if (!item || item.kind !== s.kind) throw new AppError('avatar.invalid_item', 400, { code: s.code, slot: s.slot });
    }
    const resolved = new Map<Slot['slot'], ItemRow>(slots.map((s) => [s.slot, items.get(s.code) as ItemRow]));

    // Tout doit être à toi ; sinon on dit quoi acheter et combien ça coûte.
    const rank = await bestRankOf(tx, userId);
    const owned = await ownedRows(
      tx,
      userId,
      [...resolved.values()].map((i) => i.id),
    );
    const missing = [...resolved.values()].filter((item) => !isOwned(item, rank, owned.get(item.id)));
    if (missing.length > 0) {
      const price = missing.reduce((sum, item) => {
        const buyable = item.price !== null && item.retired_at === null && !isSoldOut(item) && !isLocked(item, rank, undefined);
        return buyable ? sum + (item.price ?? 0) : sum;
      }, 0);
      throw new AppError('avatar.not_owned', 409, { items: missing.map((i) => i.code), price });
    }

    if (req.mode === 'photo' && current.rows[0]?.photo_path === null) throw new AppError('photo.missing', 409);

    const sets: string[] = [];
    const values: unknown[] = [userId];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (req.selection) {
      const sel = req.selection;
      set('avatar_item_id', sel.kind === 'preset' ? resolved.get('preset')?.id : null);
      set('avatar_skin_id', sel.kind === 'composed' ? resolved.get('skin')?.id : null);
      set('avatar_hat_id', sel.kind === 'composed' ? (resolved.get('hat')?.id ?? null) : null);
      set('avatar_outfit_id', sel.kind === 'composed' ? resolved.get('outfit')?.id : null);
    }
    if (req.frame !== undefined) set('frame_item_id', req.frame === null ? null : resolved.get('frame')?.id);
    if (req.mode) set('avatar_mode', req.mode);
    if (sets.length > 0) await tx.query(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = $1`, values);

    const row = await lookRow(tx, userId);
    if (!row) throw new AppError('auth.member_required', 403);
    return myAvatarFromRow(row, app.media);
  });
}
