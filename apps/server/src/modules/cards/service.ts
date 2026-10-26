/**
 * Collection de cartes (écran 39) : les 48 cartes du catalogue d'objets (kind = card), ce que
 * le joueur possède, ce qui reste verrouillé et comment l'obtenir, et les habillages équipés
 * (plateau, pions, dé). Les règles d'obtention sont décrites dans render.how (migration 0073) ;
 * les attributions passent par grantItem (module shop).
 *
 * Une carte est à toi : ligne owned_items, carte de départ (is_default), ou carte d'échelon
 * (min_rank) quand ton meilleur échelon l'atteint.
 */
import { rankAtLeast, type RankId } from '@kwatt/domain';
import type { Card, CardCollection, CardSlot } from '@kwatt/protocol';
import type { Pool, Sql, Transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { bestRankOf, grantItem } from '../shop/catalog.js';

interface CardRow {
  id: string;
  code: string;
  rarity: Card['rarity'];
  edition_total: number | null;
  edition_sold: number;
  min_rank: RankId | null;
  is_default: boolean;
  render: {
    type?: Card['type'];
    slot?: CardSlot;
    game?: Card['game'];
    fabric?: Card['fabric'];
    how?: Card['how'];
    rank?: RankId;
    feat?: string;
    trophy?: string;
    days?: number;
    effect?: string;
    limit?: number;
  };
  sort_order: number;
  serial: number | null;
  acquired_at: Date | null;
  owned_row: boolean;
}

const SLOT_COLUMN: Record<CardSlot, string> = { board: 'board_card_id', pieces: 'pieces_card_id', dice: 'dice_card_id' };

export async function cardRows(db: Sql, userId: string): Promise<CardRow[]> {
  const r = await db.query<CardRow>(
    `SELECT i.id, i.code, i.rarity, i.edition_total, i.edition_sold, i.min_rank, i.is_default, i.render, i.sort_order,
            o.serial, o.acquired_at, (o.item_id IS NOT NULL) AS owned_row
       FROM items i LEFT JOIN owned_items o ON o.item_id = i.id AND o.user_id = $1
      WHERE i.kind = 'card' AND (i.retired_at IS NULL OR o.item_id IS NOT NULL)
      ORDER BY i.sort_order, i.code`,
    [userId],
  );
  return r.rows;
}

function ownedCard(row: CardRow, rank: RankId): boolean {
  if (row.owned_row || row.is_default) return true;
  return row.min_rank !== null && rankAtLeast(rank, row.min_rank);
}

/** Cartes possédées (écran 09 : « 14 / 48 »). */
export async function countCards(db: Sql, userId: string): Promise<number> {
  const rows = await cardRows(db, userId);
  const rank = await bestRankOf(db, userId);
  return rows.filter((row) => ownedCard(row, rank)).length;
}

export async function collection(db: Sql, userId: string): Promise<CardCollection> {
  const rows = await cardRows(db, userId);
  const rank = await bestRankOf(db, userId);
  const eq = await db.query<{ board: string | null; pieces: string | null; dice: string | null }>(
    'SELECT board_card_id AS board, pieces_card_id AS pieces, dice_card_id AS dice FROM profiles WHERE user_id = $1',
    [userId],
  );
  const ids = eq.rows[0] ?? { board: null, pieces: null, dice: null };
  const codeOf = (id: string | null) => (id ? (rows.find((x) => x.id === id)?.code ?? null) : null);
  const equipped = { board: codeOf(ids.board), pieces: codeOf(ids.pieces), dice: codeOf(ids.dice) };
  const equippedCodes = new Set(Object.values(equipped).filter(Boolean));
  const items: Card[] = rows.map((row) => {
    const r = row.render;
    const owned = ownedCard(row, rank);
    return {
      code: row.code,
      rarity: row.rarity,
      type: r.type ?? 'pouvoir',
      slot: r.slot ?? null,
      game: r.game ?? 'both',
      fabric: r.fabric ?? 'ndop',
      how: r.how ?? 'trophy',
      rank: r.rank ?? row.min_rank,
      feat: r.feat ?? null,
      trophy: r.trophy ?? null,
      days: r.days ?? null,
      effect: r.effect ?? null,
      limit: r.limit ?? null,
      edition: row.edition_total === null ? null : { total: row.edition_total, given: row.edition_sold },
      owned,
      serial: row.serial,
      equipped: equippedCodes.has(row.code),
      acquiredAt: row.acquired_at?.toISOString() ?? null,
    };
  });
  return { owned: items.filter((c) => c.owned).length, total: items.length, items, equipped };
}

/** Équiper un habillage (ou revenir à celui de base avec null). */
export async function equip(db: Pool, userId: string, slot: CardSlot, code: string | null): Promise<void> {
  let id: string | null = null;
  if (code !== null) {
    const rows = await cardRows(db, userId);
    const row = rows.find((x) => x.code === code);
    if (!row || row.render.slot !== slot) throw new AppError('cards.not_found', 404);
    if (!ownedCard(row, await bestRankOf(db, userId))) throw new AppError('cards.not_owned', 403);
    id = row.id;
  }
  await db.query(`UPDATE profiles SET ${SLOT_COLUMN[slot]} = $2 WHERE user_id = $1`, [userId, id]);
}

/** Cartes encore à gagner d'une source et d'une rareté (ordre du catalogue). */
export async function unownedCards(db: Sql, userId: string, how: string, rarity?: string): Promise<string[]> {
  const r = await db.query<{ code: string }>(
    `SELECT i.code FROM items i
      WHERE i.kind = 'card' AND i.retired_at IS NULL AND i.render->>'how' = $2 AND ($3::text IS NULL OR i.rarity = $3)
        AND i.render->>'days' IS NULL
        AND (i.edition_total IS NULL OR i.edition_sold < i.edition_total)
        AND NOT EXISTS (SELECT 1 FROM owned_items o WHERE o.item_id = i.id AND o.user_id = $1)
      ORDER BY i.sort_order`,
    [userId, how, rarity ?? null],
  );
  return r.rows.map((x) => x.code);
}

/** Cartes d'une règle précise (victoire marquante, trophée, série longue). */
export async function cardsFor(db: Sql, field: 'feat' | 'trophy' | 'days', value: string): Promise<string[]> {
  const r = await db.query<{ code: string }>(`SELECT code FROM items WHERE kind = 'card' AND render->>'${field}' = $1 ORDER BY sort_order`, [value]);
  return r.rows.map((x) => x.code);
}

/** Donne une carte ; une édition épuisée ne se donne plus (pas d'erreur). */
export async function grantCard(db: Pool | Transaction, userId: string, code: string): Promise<boolean> {
  try {
    return (await grantItem(db, userId, code, 'reward')).granted;
  } catch (err) {
    if (err instanceof AppError && err.code === 'shop.sold_out') return false;
    throw err;
  }
}
