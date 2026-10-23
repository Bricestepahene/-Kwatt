/**
 * Cauris des ligues, toujours par le grand livre et avec une clé d'idempotence :
 * - pot ou cagnotte : séquestre `league:<id>` (entrées, bonus Kwatt, amendes ; en sortent
 *   les remboursements et le partage final) ;
 * - caution du créateur d'une ligue publique : séquestre `league-caution:<id>`.
 */
import type { Pool, Transaction } from '../../db/pool.js';
import { balanceOf, escrowBalance, transfer } from '../economy/ledger.js';

export const potKey = (leagueId: string): string => `league:${leagueId}`;
export const cautionKey = (leagueId: string): string => `league-caution:${leagueId}`;
/** Compte système d'où vient le bonus Kwatt de 25 % (et où il revient si la ligue est annulée). */
export const BONUS_ACCOUNT = 'league_bonus';

type Db = Pool | Transaction;

export async function potOf(db: Db, leagueId: string): Promise<number> {
  return escrowBalance(db, potKey(leagueId));
}

/** Entrée bloquée dans le pot (inscription). `n` distingue une réinscription. */
export async function payEntry(db: Db, leagueId: string, userId: string, amount: number, n: number): Promise<void> {
  if (amount <= 0) return;
  await transfer(db, {
    kind: 'league_entry',
    idempotencyKey: `league_entry:${leagueId}:${userId}:${n}`,
    entries: [
      { wallet: { userId }, amount: -amount },
      { wallet: { escrow: potKey(leagueId) }, amount },
    ],
    meta: { leagueId },
  });
}

/** Rend des cauris du pot à un joueur (départ avant le début, annulation, exclusion). */
export async function refundFromPot(db: Db, leagueId: string, userId: string, amount: number, key: string, reason: string): Promise<void> {
  if (amount <= 0) return;
  await transfer(db, {
    kind: 'league_refund',
    idempotencyKey: `league_refund:${leagueId}:${key}`,
    entries: [
      { wallet: { escrow: potKey(leagueId) }, amount: -amount },
      { wallet: { userId }, amount },
    ],
    meta: { leagueId, reason },
  });
}

export async function lockCaution(db: Db, leagueId: string, userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await transfer(db, {
    kind: 'league_caution',
    idempotencyKey: `league_caution:${leagueId}`,
    entries: [
      { wallet: { userId }, amount: -amount },
      { wallet: { escrow: cautionKey(leagueId) }, amount },
    ],
    meta: { leagueId },
  });
}

/** Caution rendue au créateur (fin de ligue, ou annulation avant validation). */
export async function returnCaution(db: Db, leagueId: string, userId: string): Promise<number> {
  const amount = await escrowBalance(db, cautionKey(leagueId));
  if (amount <= 0) return 0;
  await transfer(db, {
    kind: 'league_caution',
    idempotencyKey: `league_caution_return:${leagueId}`,
    entries: [
      { wallet: { escrow: cautionKey(leagueId) }, amount: -amount },
      { wallet: { userId }, amount },
    ],
    meta: { leagueId, returned: true },
  });
  return amount;
}

/** Annulation après validation : la caution est partagée entre les inscrits. */
export async function shareCaution(db: Db, leagueId: string, shares: Record<string, number>): Promise<void> {
  const entries = Object.entries(shares).filter(([, a]) => a > 0);
  if (entries.length === 0) return;
  const total = entries.reduce((s, [, a]) => s + a, 0);
  await transfer(db, {
    kind: 'league_caution',
    idempotencyKey: `league_caution_share:${leagueId}`,
    entries: [{ wallet: { escrow: cautionKey(leagueId) }, amount: -total }, ...entries.map(([userId, amount]) => ({ wallet: { userId }, amount }))],
    meta: { leagueId, shared: true },
  });
}

/** Bonus Kwatt de 25 % versé au pot à la validation. */
export async function payBonus(db: Db, leagueId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await transfer(db, {
    kind: 'league_bonus',
    idempotencyKey: `league_bonus:${leagueId}`,
    entries: [
      { wallet: { system: BONUS_ACCOUNT }, amount: -amount },
      { wallet: { escrow: potKey(leagueId) }, amount },
    ],
    meta: { leagueId },
  });
}

/** Le bonus revient à Kwatt si la ligue est annulée après validation. */
export async function takeBackBonus(db: Db, leagueId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await transfer(db, {
    kind: 'league_bonus',
    idempotencyKey: `league_bonus_back:${leagueId}`,
    entries: [
      { wallet: { escrow: potKey(leagueId) }, amount: -amount },
      { wallet: { system: BONUS_ACCOUNT }, amount },
    ],
    meta: { leagueId, back: true },
  });
}

/**
 * Amende de forfait (10 % de l'entrée), versée au pot. Elle ne dépasse jamais le solde du
 * joueur : un solde vide paie ce qu'il peut (décision : pas de dette en cauris).
 */
export async function payFine(db: Db, leagueId: string, userId: string, fine: number, matchId: string): Promise<number> {
  if (fine <= 0) return 0;
  const amount = Math.min(fine, await balanceOf(db, userId));
  if (amount <= 0) return 0;
  const r = await transfer(db, {
    kind: 'league_fine',
    idempotencyKey: `league_fine:${matchId}:${userId}`,
    entries: [
      { wallet: { userId }, amount: -amount },
      { wallet: { escrow: potKey(leagueId) }, amount },
    ],
    meta: { leagueId, matchId },
  });
  return r.replayed ? 0 : amount;
}

/** Partage final du pot (une écriture par gagnant, chacune idempotente). */
export async function payOut(db: Db, leagueId: string, payouts: Record<string, number>): Promise<void> {
  for (const [userId, amount] of Object.entries(payouts)) {
    if (amount <= 0) continue;
    await transfer(db, {
      kind: 'league_payout',
      idempotencyKey: `league_payout:${leagueId}:${userId}`,
      entries: [
        { wallet: { escrow: potKey(leagueId) }, amount: -amount },
        { wallet: { userId }, amount },
      ],
      meta: { leagueId },
    });
  }
}
