/**
 * Achats de la boutique (écrans 10 et 11) : débit par le grand livre (mouvement `purchase`,
 * clé d'idempotence `purchase:<joueur>:<objet>`), numéro d'exemplaire pour une édition
 * limitée, refus clairs (solde insuffisant : « Il te manque X », échelon trop bas, épuisé).
 *
 * Plusieurs objets peuvent s'acheter d'un coup (pièces d'avatar du Studio) : tout ou rien.
 */
import type { BuyResponse, Purchase, PurchaseMeta } from '@kwatt/protocol';
import { transaction, type Pool, type Transaction } from '../../db/pool.js';
import { AppError, isAppError } from '../../lib/errors.js';
import { balanceOf, findTransfer, transfer } from '../economy/ledger.js';
import {
  bestRankOf,
  insertOwned,
  isLocked,
  isOwned,
  isSoldOut,
  itemsByCodes,
  lockOwnership,
  ownedRows,
  takeSerial,
  toShopItem,
  type ItemRow,
} from './catalog.js';

/** Compte système qui reçoit les cauris des achats (0001). */
export const SHOP_WALLET = 'shop';

export function purchaseKey(userId: string, itemCode: string): string {
  return `purchase:${userId}:${itemCode}`;
}

/**
 * Achète un ou plusieurs objets. Rejouer un achat déjà fait (même joueur, même objet) rend
 * l'achat existant sans nouveau débit (`replayed: true`).
 */
export async function buyItems(db: Pool | Transaction, userId: string, codes: readonly string[]): Promise<BuyResponse> {
  const unique = [...new Set(codes)].sort();
  return transaction(db, async (tx) => {
    // Verrous dans un ordre fixe : deux achats croisés ne s'attendent jamais mutuellement.
    for (const code of unique) await lockOwnership(tx, userId, code);

    const items = await itemsByCodes(tx, unique);
    for (const code of unique) {
      if (!items.has(code)) throw new AppError('shop.item_not_found', 404, { code });
    }
    const list = unique.map((code) => items.get(code) as ItemRow);
    const owned = await ownedRows(
      tx,
      userId,
      list.map((i) => i.id),
    );
    const rank = await bestRankOf(tx, userId);

    const replays: Purchase[] = [];
    const toBuy: ItemRow[] = [];
    for (const item of list) {
      const row = owned.get(item.id);
      if (row?.source === 'purchase' && row.tx_id) {
        replays.push({
          code: item.code,
          price: await paidPrice(tx, userId, item),
          serial: row.serial,
          txId: row.tx_id,
          replayed: true,
          acquiredAt: row.acquired_at.toISOString(),
        });
        continue;
      }
      if (isOwned(item, rank, row)) throw new AppError('shop.already_owned', 409, { code: item.code });
      if (item.price === null || item.retired_at !== null) throw new AppError('shop.not_for_sale', 409, { code: item.code });
      if (isLocked(item, rank, row)) {
        throw new AppError('shop.rank_too_low', 403, { code: item.code, requiredRank: item.min_rank, rank });
      }
      if (isSoldOut(item)) throw new AppError('shop.sold_out', 409, { code: item.code, total: item.edition_total });
      toBuy.push(item);
    }

    const total = toBuy.reduce((sum, item) => sum + (item.price ?? 0), 0);
    const balance = await balanceOf(tx, userId);
    if (total > balance) throw insufficient(total, balance);

    const purchases: Purchase[] = [...replays];
    for (const item of toBuy) {
      const price = item.price as number;
      // Numéro d'exemplaire d'abord : la ligne de l'objet reste verrouillée jusqu'à la fin.
      const serial = await takeSerial(tx, item);
      const meta: PurchaseMeta = { itemCode: item.code, itemKind: item.kind, serial };
      let moved;
      try {
        moved = await transfer(tx, {
          kind: 'purchase',
          idempotencyKey: purchaseKey(userId, item.code),
          entries: [
            { wallet: { userId }, amount: -price },
            { wallet: { system: SHOP_WALLET }, amount: price },
          ],
          meta,
        });
      } catch (err) {
        // Autre dépense simultanée : le grand livre a refusé le découvert.
        if (isAppError(err) && err.code === 'wallet.insufficient_funds') throw insufficient(total, await balanceOf(tx, userId));
        throw err;
      }
      // Un achat déjà payé (objet retiré à la main depuis) est rendu sans nouveau débit.
      const acquiredAt = await insertOwned(tx, { userId, itemId: item.id, serial, source: 'purchase', txId: moved.txId });
      purchases.push({ code: item.code, price, serial, txId: moved.txId, replayed: moved.replayed, acquiredAt: acquiredAt.toISOString() });
    }

    const after = await itemsByCodes(tx, unique);
    const ownedAfter = await ownedRows(
      tx,
      userId,
      list.map((i) => i.id),
    );
    return {
      purchases: unique.map((code) => purchases.find((p) => p.code === code) as Purchase),
      balance: await balanceOf(tx, userId),
      items: unique.map((code) => {
        const item = after.get(code) as ItemRow;
        return toShopItem(item, rank, ownedAfter.get(item.id));
      }),
    };
  });
}

function insufficient(price: number, balance: number): AppError {
  return new AppError('shop.insufficient_funds', 409, { price, balance, missing: Math.max(0, price - balance) });
}

/** Prix effectivement payé lors d'un achat déjà fait (lu au grand livre). */
async function paidPrice(tx: Transaction, userId: string, item: ItemRow): Promise<number> {
  const done = await findTransfer(tx, purchaseKey(userId, item.code));
  const credit = done?.entries.find((e) => e.amount > 0)?.amount;
  return credit ?? item.price ?? 0;
}
