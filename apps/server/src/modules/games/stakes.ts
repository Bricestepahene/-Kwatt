/**
 * Mises entre joueurs (SPEC §6 et §7, écrans 24 à 26) : qui peut miser, plafond, appareils.
 * Les règles viennent de @kwatt/domain (`stakeRefusal`, `stakeCap`) ; ce fichier lit en base
 * ce qu'il leur faut (âge, adresse vérifiée, solde, échelon, appareils).
 */
import { isRatedVariant, rankForRating, stakeCap, stakeRefusal, type RankId, type StakeCap } from '@kwatt/domain';
import type { StakeCapView } from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { ageInYear } from '../auth/age.js';
import { sharedDevicePairs } from '../auth/devices.js';
import { balanceOf } from '../economy/ledger.js';
import { ratingOf } from '../ratings/service.js';

export interface StakeProfile {
  userId: string;
  refusal: 'stake.guest' | 'stake.underage' | 'stake.email_unverified' | null;
  balance: number;
  rank: RankId;
}

/** Variante qui donne l'échelon de la table (une variante non classée prend la classique). */
function ratedOf(variant: string) {
  if (isRatedVariant(variant)) return variant;
  return variant.startsWith('ludo') ? 'ludo_classique' : 'dames10';
}

export async function stakeProfile(db: Sql, userId: string, variant: string, now: Date): Promise<StakeProfile> {
  const r = await db.query<{ kind: 'guest' | 'member'; birth_year: number | null; verified: boolean }>(
    `SELECT u.kind::text AS kind, u.birth_year,
            EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id = u.id AND a.verified_at IS NOT NULL) AS verified
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  const u = r.rows[0];
  const refusal = u
    ? stakeRefusal({ kind: u.kind, age: u.birth_year === null ? null : ageInYear(u.birth_year, now), emailVerified: u.verified })
    : 'stake.guest';
  const [balance, rating] = await Promise.all([balanceOf(db, userId), ratingOf(db, userId, ratedOf(variant))]);
  return { userId, refusal, balance, rank: rankForRating(rating.rating).id };
}

/** Plafond d'une mise entre ces joueurs (et pourquoi elle est impossible le cas échéant). */
export async function capBetween(db: Sql, userIds: string[], variant: string, now: Date, viewerId: string): Promise<{ view: StakeCapView; cap: StakeCap | null }> {
  const profiles = await Promise.all(userIds.map((id) => stakeProfile(db, id, variant, now)));
  const mine = profiles.find((p) => p.userId === viewerId);
  let refusal: string | null = profiles.find((p) => p.refusal)?.refusal ?? null;
  // Le refus du lecteur passe avant celui de l'autre (message plus utile).
  if (mine?.refusal) refusal = mine.refusal;
  if (!refusal && (await sharedDevicePairs(db, userIds)).length > 0) refusal = 'stake.same_device';
  const cap = stakeCap(profiles.map((p) => ({ userId: p.userId, balance: p.balance, rank: p.rank })));
  return {
    cap: refusal ? null : cap,
    view: { max: refusal ? 0 : cap.max, balanceCap: cap.balanceCap, tableLimit: cap.tableLimit, limitedBy: cap.limitedBy, myBalance: mine?.balance ?? 0, refusal },
  };
}

/** Vérifie une mise entre ces joueurs ; lève le code d'erreur sinon. */
export async function assertStake(db: Sql, userIds: string[], variant: string, stake: number, now: Date, viewerId: string): Promise<void> {
  if (!Number.isInteger(stake) || stake < 0) throw new AppError('stake.invalid', 400);
  if (stake === 0) return;
  const { view } = await capBetween(db, userIds, variant, now, viewerId);
  if (view.refusal) throw new AppError(view.refusal as 'stake.guest', 403);
  if (stake > view.max) throw new AppError('stake.above_cap', 409, { max: view.max });
}
