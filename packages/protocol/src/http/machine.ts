/**
 * Machine : offres, gains, résultats hors connexion (contrat C2 de docs/CONTRATS-V2.md ;
 * fournisseur : équipe Dames ; consommateurs : Ludo, Parties en ligne). Écrit tel quel par
 * le consommateur Ludo en attendant le fournisseur : l'intégration garde une seule copie.
 *
 *   GET  /v1/machine/offers?family=dames|ludo&variant=…&machines=1..3 → MachineOffers
 *   POST /v1/machine/results (hors connexion, rejouable, idempotent par clientGameId) → MachineResult
 *     Dames : coups en notation officielle ; Ludo : "roll:token" ou "roll:-" (pas de coup).
 *     Partie illégale → machine.invalid_game. Pas de pari hors connexion.
 */
import { z } from 'zod';
import { IsoDateSchema } from './common.js';

export const MACHINE_FAMILIES = ['dames', 'ludo'] as const;
export const MachineFamilySchema = z.enum(MACHINE_FAMILIES);
export type MachineFamily = z.infer<typeof MachineFamilySchema>;

/** Difficultés de l'écran 15 (relatives à la force du joueur). */
export const MACHINE_DIFFICULTY_IDS = ['facile', 'moyen', 'coriace', 'ton_niveau', 'fon'] as const;
export const MachineDifficultySchema = z.enum(MACHINE_DIFFICULTY_IDS);
export type MachineDifficultyId = z.infer<typeof MachineDifficultySchema>;

export const MachineModeSchema = z.enum(['auto', 'chosen']);
export type MachineMode = z.infer<typeof MachineModeSchema>;

export const MachineOffersQuerySchema = z.object({
  family: MachineFamilySchema,
  variant: z.string(),
  machines: z.coerce.number().int().min(1).max(3).optional(),
});
export type MachineOffersQuery = z.infer<typeof MachineOffersQuerySchema>;

export const MachineDifficultyOfferSchema = z.object({
  id: MachineDifficultySchema,
  /** Chance de gagner du joueur. */
  p: z.number(),
  /** Cote = 0,9 ÷ p. */
  odds: z.number(),
  oddsHundredths: z.number().int(),
  baseReward: z.number().int(),
  unlocked: z.boolean(),
  machineRating: z.number(),
});
export type MachineDifficultyOffer = z.infer<typeof MachineDifficultyOfferSchema>;

export const MachineAutoSchema = z.object({ difficulty: MachineDifficultySchema, streak: z.number().int() });

export const MachineOffersSchema = z.object({
  rating: z.number(),
  rank: z.string(),
  difficulties: z.array(MachineDifficultyOfferSchema),
  auto: MachineAutoSchema,
  winStreak: z.number().int(),
  rewardedToday: z.number().int(),
  dailyLimit: z.number().int(),
  betCap: z.number().int(),
});
export type MachineOffers = z.infer<typeof MachineOffersSchema>;

export const MachineResultRequestSchema = z.object({
  clientGameId: z.string().min(1).max(64),
  family: MachineFamilySchema,
  variant: z.string(),
  difficulty: MachineDifficultySchema,
  mode: MachineModeSchema,
  /** Ludo : 1 à 3 machines. */
  machines: z.number().int().min(1).max(3).optional(),
  /** Graine de la machine (déterminisme). */
  seed: z.number().int(),
  moves: z.array(z.string()),
  playedAt: IsoDateSchema,
});
export type MachineResultRequest = z.infer<typeof MachineResultRequestSchema>;

export const MachineSettlementSchema = z.object({
  net: z.number().int(),
  base: z.number().int(),
  participation: z.number().int(),
  betNet: z.number().int(),
  streakBonus: z.number().int(),
  counted: z.boolean(),
});
export type MachineSettlement = z.infer<typeof MachineSettlementSchema>;

export const MachineRatingChangeSchema = z.object({
  before: z.number(),
  after: z.number(),
  delta: z.number(),
  levelBefore: z.number().int(),
  levelAfter: z.number().int(),
});
export type MachineRatingChange = z.infer<typeof MachineRatingChangeSchema>;

export const MachineResultSchema = z.object({
  outcome: z.enum(['win', 'loss', 'draw']),
  settlement: MachineSettlementSchema,
  rating: MachineRatingChangeSchema.nullable(),
  auto: MachineAutoSchema,
  winStreak: z.number().int(),
});
export type MachineResult = z.infer<typeof MachineResultSchema>;
