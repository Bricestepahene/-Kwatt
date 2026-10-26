/**
 * Catalogue d'objets générique (avatars, cadres, cartes, habillages) et objets possédés.
 *
 * Pour les autres modules (cartes, quêtes, trophées, quartiers…) :
 *
 *   import { grantItem } from '../shop/catalog.js';
 *   await grantItem(tx, userId, 'card_table_wouri', 'reward');   // idempotent
 *
 * Un objet appartient au joueur s'il a une ligne dans owned_items, s'il est « de base »
 * (is_default), ou s'il ne s'achète pas et que le meilleur échelon du joueur atteint son
 * échelon minimal (« Trône du Fon »). Le meilleur échelon est celui de la meilleure force,
 * toutes variantes classées confondues.
 */
import { START_RATING, rankAtLeast, rankForRating, type RankId } from '@kwatt/domain';
import type { ItemKind, ItemRarity, ItemSource, ShopItem } from '@kwatt/protocol';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

export interface ItemRow {
  id: string;
  code: string;
  kind: ItemKind;
  rarity: ItemRarity;
  price: number | null;
  edition_total: number | null;
  edition_sold: number;
  min_rank: RankId | null;
  is_default: boolean;
  render: Record<string, unknown>;
  sort_order: number;
  retired_at: Date | null;
}

export interface OwnedRow {
  item_id: string;
  serial: number | null;
  source: ItemSource;
  tx_id: string | null;
  acquired_at: Date;
}

const ITEM_COLUMNS = `i.id, i.code, i.kind, i.rarity, i.price, i.edition_total, i.edition_sold, i.min_rank,
  i.is_default, i.render, i.sort_order, i.retired_at`;

/** Meilleur échelon du joueur (meilleure force classée ; force de départ s'il n'a pas joué). */
export async function bestRankOf(db: Sql, userId: string): Promise<RankId> {
  const r = await db.query<{ rating: number | null }>('SELECT max(rating) AS rating FROM player_ratings WHERE user_id = $1', [
    userId,
  ]);
  return rankForRating(r.rows[0]?.rating ?? START_RATING).id;
}

export async function itemsByCodes(db: Sql, codes: readonly string[]): Promise<Map<string, ItemRow>> {
  if (codes.length === 0) return new Map();
  const r = await db.query<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items i WHERE i.code = ANY($1::text[])`, [codes]);
  return new Map(r.rows.map((row) => [row.code, row]));
}

export async function ownedRows(db: Sql, userId: string, itemIds?: readonly string[]): Promise<Map<string, OwnedRow>> {
  const r = await db.query<OwnedRow>(
    `SELECT item_id, serial, source, tx_id, acquired_at FROM owned_items
      WHERE user_id = $1 AND ($2::uuid[] IS NULL OR item_id = ANY($2::uuid[]))`,
    [userId, itemIds ?? null],
  );
  return new Map(r.rows.map((row) => [row.item_id, row]));
}

/** Échelon trop bas pour l'objet (un objet déjà à toi n'est jamais verrouillé). */
export function isLocked(item: ItemRow, rank: RankId, owned: OwnedRow | undefined): boolean {
  return owned === undefined && item.min_rank !== null && !rankAtLeast(rank, item.min_rank);
}

/** L'objet est-il à toi ? (ligne possédée, objet de base, ou déblocage d'échelon gratuit). */
export function isOwned(item: ItemRow, rank: RankId, owned: OwnedRow | undefined): boolean {
  if (owned) return true;
  if (item.is_default) return true;
  return item.price === null && item.min_rank !== null && rankAtLeast(rank, item.min_rank);
}

export function isSoldOut(item: ItemRow): boolean {
  return item.edition_total !== null && item.edition_sold >= item.edition_total;
}

export function toShopItem(item: ItemRow, rank: RankId, owned: OwnedRow | undefined): ShopItem {
  const mine = isOwned(item, rank, owned);
  const locked = isLocked(item, rank, owned);
  return {
    code: item.code,
    kind: item.kind,
    rarity: item.rarity,
    price: item.price,
    edition: item.edition_total === null ? null : { total: item.edition_total, sold: item.edition_sold },
    minRank: item.min_rank,
    isDefault: item.is_default,
    render: item.render,
    owned: mine,
    serial: owned?.serial ?? null,
    locked,
    buyable: item.price !== null && !mine && !locked && !isSoldOut(item) && item.retired_at === null,
    sortOrder: item.sort_order,
  };
}

/**
 * Catalogue vu par un joueur : objets en vente ou visibles, plus ceux qu'il possède même
 * retirés de la vente. `kinds` restreint aux familles voulues.
 */
export async function listCatalog(db: Sql, userId: string, kinds?: readonly ItemKind[]): Promise<{ items: ShopItem[]; rank: RankId }> {
  const [rank, items, owned] = await Promise.all([
    bestRankOf(db, userId),
    db.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM items i
        WHERE ($2::text[] IS NULL OR i.kind = ANY($2::text[]))
          AND (i.retired_at IS NULL OR EXISTS (SELECT 1 FROM owned_items o WHERE o.item_id = i.id AND o.user_id = $1))
        ORDER BY i.sort_order, i.code`,
      [userId, kinds && kinds.length > 0 ? kinds : null],
    ),
    ownedRows(db, userId),
  ]);
  return { rank, items: items.rows.map((item) => toShopItem(item, rank, owned.get(item.id))) };
}

/**
 * Verrou de transaction sur le couple (joueur, objet) : deux attributions simultanées du même
 * objet au même joueur passent l'une après l'autre (pas de numéro d'exemplaire gâché).
 */
export async function lockOwnership(tx: Transaction, userId: string, itemCode: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`owned_item:${userId}:${itemCode}`]);
}

/**
 * Numéro d'exemplaire suivant d'une édition limitée. La ligne de l'objet reste verrouillée
 * jusqu'à la fin de la transaction : jamais deux fois le même numéro, et un achat annulé
 * rend son numéro.
 */
export async function takeSerial(tx: Transaction, item: ItemRow): Promise<number | null> {
  if (item.edition_total === null) return null;
  const r = await tx.query<{ edition_sold: number }>(
    'UPDATE items SET edition_sold = edition_sold + 1 WHERE id = $1 AND edition_sold < edition_total RETURNING edition_sold',
    [item.id],
  );
  const serial = r.rows[0]?.edition_sold;
  if (serial === undefined) throw new AppError('shop.sold_out', 409, { code: item.code, total: item.edition_total });
  return serial;
}

export async function insertOwned(
  tx: Transaction,
  input: { userId: string; itemId: string; serial: number | null; source: ItemSource; txId: string | null },
): Promise<Date> {
  const r = await tx.query<{ acquired_at: Date }>(
    `INSERT INTO owned_items (user_id, item_id, serial, source, tx_id, acquired_at)
     VALUES ($1, $2, $3, $4, $5, clock_timestamp()) RETURNING acquired_at`,
    [input.userId, input.itemId, input.serial, input.source, input.txId],
  );
  const at = r.rows[0]?.acquired_at;
  if (!at) throw new Error('objet possédé non enregistré');
  return at;
}

export interface GrantResult {
  code: string;
  /** false : le joueur l'avait déjà (rien n'a changé). */
  granted: boolean;
  serial: number | null;
}

/**
 * Donne un objet à un joueur (récompense, objet de base…), sans débit. Idempotent : un objet
 * déjà possédé n'est pas redonné. Une édition limitée reçoit son numéro d'exemplaire
 * (shop.sold_out si elle est épuisée). Utilisable dans la transaction de l'appelant.
 */
export async function grantItem(
  db: Pool | Transaction,
  userId: string,
  itemCode: string,
  source: Exclude<ItemSource, 'purchase'>,
): Promise<GrantResult> {
  return transaction(db, async (tx) => {
    await lockOwnership(tx, userId, itemCode);
    const item = (await itemsByCodes(tx, [itemCode])).get(itemCode);
    if (!item) throw new AppError('shop.item_not_found', 404, { code: itemCode });
    const existing = (await ownedRows(tx, userId, [item.id])).get(item.id);
    if (existing) return { code: item.code, granted: false, serial: existing.serial };
    const serial = await takeSerial(tx, item);
    await insertOwned(tx, { userId, itemId: item.id, serial, source, txId: null });
    return { code: item.code, granted: true, serial };
  });
}

/** Nombre d'objets d'une famille possédés (lignes owned_items, ex. les cartes). */
export async function countOwned(db: Sql, userId: string, kind: ItemKind): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM owned_items o JOIN items i ON i.id = o.item_id WHERE o.user_id = $1 AND i.kind = $2`,
    [userId, kind],
  );
  return r.rows[0]?.n ?? 0;
}
