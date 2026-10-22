/**
 * Mises entre joueurs (écran 26, SPEC §6 et §7).
 *
 * - Profils de 18 ans et plus seulement (pas d'invité, pas de compte jeune).
 * - Plafond = min(25 % du plus petit solde des joueurs qui misent, limite de
 *   la table). La limite de la table dépend de l'échelon le plus bas des
 *   joueurs qui misent : 50 / 100 / 200 / 500 / 2 000 / 5 000.
 * - Jamais deux comptes vus sur le même appareil l'un contre l'autre.
 */
import { lowestRank, type RankId } from './ranks.js';

export const STAKE_BALANCE_SHARE_PERCENT = 25;

export interface StakingPlayer {
  userId: string;
  balance: number;
  rank: RankId;
}

export interface StakeCap {
  /** Mise maximale par joueur. */
  max: number;
  /** 25 % du plus petit solde. */
  balanceCap: number;
  /** Limite de la table (échelon le plus bas). */
  tableLimit: number;
  /** Ce qui fixe le plafond. */
  limitedBy: 'balance' | 'table';
}

export function stakeCap(players: readonly StakingPlayer[]): StakeCap {
  if (players.length < 2) throw new Error('Une mise se joue à deux au moins');
  const minBalance = Math.min(...players.map((p) => p.balance));
  const balanceCap = Math.max(0, Math.floor((minBalance * STAKE_BALANCE_SHARE_PERCENT) / 100));
  const tableLimit = lowestRank(players.map((p) => p.rank)).tableLimit;
  return balanceCap <= tableLimit
    ? { max: balanceCap, balanceCap, tableLimit, limitedBy: 'balance' }
    : { max: tableLimit, balanceCap, tableLimit, limitedBy: 'table' };
}

export interface StakeEligibilityInput {
  kind: 'guest' | 'member';
  /** Âge calculé à partir de l'année de naissance ; null pour un invité. */
  age: number | null;
  emailVerified: boolean;
}

export type StakeRefusal = 'stake.guest' | 'stake.underage' | 'stake.email_unverified';

/** Peut-on miser ? Renvoie null si oui, sinon le code d'erreur. */
export function stakeRefusal(p: StakeEligibilityInput): StakeRefusal | null {
  if (p.kind !== 'member') return 'stake.guest';
  if (p.age === null || p.age < 18) return 'stake.underage';
  if (!p.emailVerified) return 'stake.email_unverified';
  return null;
}

export interface DevicePlayer {
  userId: string;
  /** Identifiants des installations où ce compte a été vu. */
  deviceIds: readonly string[];
}

/**
 * Paires de joueurs (comptes différents) déjà vus sur un même appareil : ils
 * ne peuvent pas miser l'un contre l'autre, ni être à la même table avec mise.
 */
export function sameDeviceConflicts(players: readonly DevicePlayer[]): [string, string][] {
  const conflicts: [string, string][] = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]!;
      const b = players[j]!;
      if (a.userId === b.userId) continue;
      const devices = new Set(a.deviceIds);
      if (b.deviceIds.some((d) => devices.has(d))) conflicts.push([a.userId, b.userId]);
    }
  }
  return conflicts;
}

export function canStakeTogether(players: readonly DevicePlayer[]): boolean {
  return sameDeviceConflicts(players).length === 0;
}

/** Vérifie une mise proposée : entier, positif, sous le plafond, soldes suffisants. */
export function validateStake(amount: number, players: readonly StakingPlayer[]): 'stake.invalid' | 'stake.above_cap' | null {
  if (!Number.isInteger(amount) || amount <= 0) return 'stake.invalid';
  if (amount > stakeCap(players).max) return 'stake.above_cap';
  return null;
}

/** Pot entre joueurs : le gagnant prend tout ; nulle (Dames) : chacun récupère sa mise. */
export function settleStakes(stake: number, playerIds: readonly string[], winnerId: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of playerIds) out[id] = winnerId === null ? stake : id === winnerId ? stake * playerIds.length : 0;
  return out;
}
