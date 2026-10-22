/**
 * Offres de l'écran 15 (module pur) : à partir de la réponse du serveur, ou calculées sur
 * l'appareil sans réseau (force gardée, sinon 900), avec @kwatt/domain. Aperçu « Si tu
 * gagnes / Si tu perds », pari par pas de 50, série ×1,5.
 */
import {
  DAILY_REWARDED_MACHINE_GAMES,
  MACHINE_BET_STEP,
  MACHINE_DIFFICULTIES,
  START_RATING,
  difficultyOffers,
  machinePreview,
  rankForRating,
  streakBonusApplies,
  type MachineDifficultyId,
} from '@kwatt/domain';
import type { MachineDifficultyOffer, MachineOffersResponse } from '@kwatt/protocol';

/** Offres calculées sur l'appareil, sans réseau : pas de pari (D-08). */
export function localOffers(rating: number | null, progress?: Pick<MachineOffersResponse, 'auto' | 'winStreak' | 'rewardedToday'>): MachineOffersResponse {
  const r = rating ?? START_RATING;
  const rank = rankForRating(r).id;
  const difficulties: MachineDifficultyOffer[] = difficultyOffers(r, rank).map((d) => {
    const p = MACHINE_DIFFICULTIES.find((x) => x.id === d.id)!.p;
    return { id: d.id, p, odds: d.oddsHundredths / 100, oddsHundredths: d.oddsHundredths, baseReward: d.baseReward, unlocked: d.unlocked, machineRating: d.machineRating };
  });
  return {
    rating: r,
    rank,
    difficulties,
    auto: progress?.auto ?? { difficulty: 'ton_niveau', streak: 0 },
    winStreak: progress?.winStreak ?? 0,
    rewardedToday: progress?.rewardedToday ?? 0,
    dailyLimit: DAILY_REWARDED_MACHINE_GAMES,
    betCap: 0,
  };
}

/** Pari suivant / précédent, par pas de 50, entre 0 et le plafond. */
export function stepBet(bet: number, direction: 1 | -1, cap: number): number {
  const next = bet + direction * MACHINE_BET_STEP;
  return Math.max(0, Math.min(Math.floor(cap / MACHINE_BET_STEP) * MACHINE_BET_STEP, next));
}

/** Pari de départ : 200 comme la planche, ramené sous le plafond. */
export function initialBet(cap: number): number {
  return stepBet(0, 1, cap) === 0 ? 0 : Math.min(200, Math.floor(cap / MACHINE_BET_STEP) * MACHINE_BET_STEP);
}

export interface BetPreview {
  ifWin: number;
  ifLoss: number;
  base: number;
  /** La prochaine victoire profite de la série ×1,5. */
  streakNext: boolean;
}

export function betPreview(offer: MachineDifficultyOffer, bet: number, winStreak: number): BetPreview {
  const p = machinePreview(offer.id as MachineDifficultyId, bet, offer.oddsHundredths);
  const streakNext = streakBonusApplies(winStreak);
  const base = streakNext ? Math.floor((offer.baseReward * 3) / 2) : offer.baseReward;
  return { ifWin: p.ifWin - offer.baseReward + base, ifLoss: p.ifLoss, base, streakNext };
}

/** Cote affichée « 1,8 » / « 1.8 » (une décimale au plus, sans zéro inutile). */
export function oddsLabel(oddsHundredths: number, decimal: ',' | '.'): string {
  const v = Math.round(oddsHundredths / 10) / 10;
  return String(v).replace('.', decimal);
}
