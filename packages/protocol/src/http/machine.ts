/**
 * Défi contre la machine (contrat C2, écrans 14, 15, 20) : offres, gains, résultats des
 * parties jouées hors connexion.
 *
 * Routes (profils seulement) :
 *   GET  /v1/machine/offers?family=dames|ludo&variant=…&machines=1..3 → MachineOffersResponse
 *   POST /v1/machine/results  MachineResultRequest → MachineResultResponse
 *        (hors connexion, rejouable, idempotent par clientGameId ; le serveur rejoue la partie)
 *
 * Cote = 0,9 ÷ p ; gains de base Facile/Moyen 25, Coriace 40, Ton niveau 60, Fon 100 ;
 * série de 3 victoires → prochain gain ×1,5 ; 10 parties récompensées par jour et par jeu.
 * Hors connexion : pas de pari (D-08).
 */
import { z } from 'zod';
import { IsoDateSchema } from './common.js';
import { RatingChangeSchema } from './ratings.js';
import { ProfileRankSchema } from './shop.js';

export const MACHINE_FAMILIES = ['dames', 'ludo'] as const;
export const MachineFamilySchema = z.enum(MACHINE_FAMILIES);
export type MachineFamily = z.infer<typeof MachineFamilySchema>;

export const MACHINE_DIFFICULTY_CODES = ['facile', 'moyen', 'coriace', 'ton_niveau', 'fon'] as const;
export const MachineDifficultySchema = z.enum(MACHINE_DIFFICULTY_CODES);
export type MachineDifficultyCode = z.infer<typeof MachineDifficultySchema>;

export const MachineModeSchema = z.enum(['auto', 'chosen']);
export type MachineMode = z.infer<typeof MachineModeSchema>;

/** Variantes jouables contre la machine. */
export const MACHINE_VARIANTS = {
  dames: ['dames10', 'dames8'],
  ludo: ['ludo_classique', 'ludo_rapide', 'ludo_six', 'ludo_parchis', 'ludo_pachisi'],
} as const;
export const MachineVariantSchema = z.enum([...MACHINE_VARIANTS.dames, ...MACHINE_VARIANTS.ludo]);
export type MachineVariant = z.infer<typeof MachineVariantSchema>;

export const MachineOffersQuerySchema = z.object({
  family: MachineFamilySchema,
  variant: MachineVariantSchema,
  /** Ludo : nombre de machines autour de la table (1 à 3). Dames : 1. */
  machines: z.coerce.number().int().min(1).max(3).default(1),
});
export type MachineOffersQuery = z.infer<typeof MachineOffersQuerySchema>;

export const MachineDifficultyOfferSchema = z.object({
  id: MachineDifficultySchema,
  /** Chance de gagner visée (à plusieurs machines : chance de finir premier). */
  p: z.number().gt(0).lt(1),
  /** Cote décimale (0,9 ÷ p), pour l'affichage « ×1,8 ». */
  odds: z.number().positive(),
  /** Cote en centièmes entiers (calculs exacts). */
  oddsHundredths: z.number().int().positive(),
  /** Gain d'une victoire sans pari. */
  baseReward: z.number().int().nonnegative(),
  /** Fon : débloqué à l'échelon Chef. */
  unlocked: z.boolean(),
  /** Force de la machine (moteur : `targetRating`). */
  machineRating: z.number().int(),
});
export type MachineDifficultyOffer = z.infer<typeof MachineDifficultyOfferSchema>;

export const AutoDifficultySchema = z.object({
  difficulty: MachineDifficultySchema,
  /** > 0 : victoires de suite ; < 0 : défaites de suite. */
  streak: z.number().int(),
});
export type AutoDifficulty = z.infer<typeof AutoDifficultySchema>;

export const MachineOffersResponseSchema = z.object({
  rating: z.number().int(),
  rank: ProfileRankSchema,
  difficulties: z.array(MachineDifficultyOfferSchema),
  auto: AutoDifficultySchema,
  /** Victoires de suite contre la machine (série ×1,5 à 3, 6, 9…). */
  winStreak: z.number().int().nonnegative(),
  /** Parties déjà récompensées aujourd'hui pour ce jeu. */
  rewardedToday: z.number().int().nonnegative(),
  dailyLimit: z.literal(10),
  /** Pari maximal (25 % du solde au pas de 50 inférieur ; 0 sans droit de miser). */
  betCap: z.number().int().nonnegative(),
});
export type MachineOffersResponse = z.infer<typeof MachineOffersResponseSchema>;

export const MachineSettlementSchema = z.object({
  /** Variation totale du solde. */
  net: z.number().int(),
  /** Gain de base (victoire), série comprise. */
  base: z.number().int().nonnegative(),
  /** Participation (+10) : défaite ou nulle. */
  participation: z.number().int().nonnegative(),
  /** Gain net du pari (+ si gagné, − si perdu). */
  betNet: z.number().int(),
  /** La série ×1,5 a été appliquée. */
  streakBonus: z.boolean(),
  /** La partie compte dans les 10 récompensées du jour. */
  counted: z.boolean(),
});
export type MachineSettlementView = z.infer<typeof MachineSettlementSchema>;

/** Coup Dames : notation officielle (« 32-28 », « 28x19x10 »). Ludo : « 6:2 » (lancer:pion) ou « 3:- » (pas de coup). */
export const MachineMoveSchema = z.string().min(3).max(80).regex(/^[0-9x:.\-b]+$/);

export const MachineResultRequestSchema = z.object({
  /** Identifiant généré par l'appli (UUID conseillé) : idempotence des renvois. */
  clientGameId: z.string().min(8).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  family: MachineFamilySchema,
  variant: MachineVariantSchema,
  difficulty: MachineDifficultySchema,
  mode: MachineModeSchema,
  /** Ludo : 1 à 3 machines. */
  machines: z.number().int().min(1).max(3).optional(),
  /** Graine de la machine (déterminisme : le serveur rejoue chaque coup de la machine). */
  seed: z.number().int().min(0).max(4_294_967_295),
  /**
   * Dames : force visée par la machine pendant la partie (offre du moment). Facultative ;
   * absente, le serveur prend la force actuelle du joueur. Elle doit rester proche de l'offre
   * du serveur (la force du joueur a pu bouger entre la partie et l'envoi).
   */
  machineRating: z.number().int().min(0).max(4000).optional(),
  moves: z.array(MachineMoveSchema).max(2000),
  playedAt: IsoDateSchema,
});
export type MachineResultRequest = z.infer<typeof MachineResultRequestSchema>;

export const MachineOutcomeSchema = z.enum(['win', 'loss', 'draw']);
export type MachineOutcomeCode = z.infer<typeof MachineOutcomeSchema>;

export const MachineResultResponseSchema = z.object({
  outcome: MachineOutcomeSchema,
  settlement: MachineSettlementSchema,
  /** null : variante non classée (Parchís, Pachisi). */
  rating: RatingChangeSchema.nullable(),
  auto: AutoDifficultySchema,
  winStreak: z.number().int().nonnegative(),
});
export type MachineResultResponse = z.infer<typeof MachineResultResponseSchema>;
