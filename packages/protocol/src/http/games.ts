/**
 * Parties en ligne (contrat C3, fournisseur : équipe Parties en ligne). Copie écrite par
 * l'équipe Dames, qui consomme ces routes (écrans 15, 18, 19), exactement selon
 * docs/CONTRATS-V2.md : l'intégration fusionnera les deux copies.
 *
 *   POST /v1/games/machine  CreateMachineGameRequest → { gameId }
 *   GET  /v1/games/:id      → GameSummary (résumé et rejeu)
 */
import { z } from 'zod';
import { MachineDifficultySchema, MachineFamilySchema, MachineModeSchema, MachineSettlementSchema, MachineVariantSchema } from './machine.js';
import { PlayerLookSchema } from './profiles.js';
import { RatingChangeSchema } from './ratings.js';

export const CreateMachineGameRequestSchema = z.object({
  family: MachineFamilySchema,
  variant: MachineVariantSchema,
  difficulty: MachineDifficultySchema,
  mode: MachineModeSchema,
  bet: z.number().int().nonnegative(),
  machines: z.number().int().min(1).max(3).optional(),
});
export type CreateMachineGameRequest = z.infer<typeof CreateMachineGameRequestSchema>;

export const CreateMachineGameResponseSchema = z.object({ gameId: z.string() });
export type CreateMachineGameResponse = z.infer<typeof CreateMachineGameResponseSchema>;

export const GameSeatSchema = z.object({
  seat: z.number().int().nonnegative(),
  userId: z.string().nullable(),
  pseudo: z.string(),
  avatar: PlayerLookSchema.nullable().optional(),
  machine: z.object({ difficulty: z.string() }).optional(),
  team: z.number().int().optional(),
});
export type GameSeat = z.infer<typeof GameSeatSchema>;

export const GameSummarySchema = z.object({
  id: z.string(),
  family: MachineFamilySchema,
  variant: z.string(),
  context: z.enum(['machine', 'room', 'league']),
  status: z.enum(['waiting', 'playing', 'finished', 'aborted']),
  seats: z.array(GameSeatSchema),
  /** Même format que C2 (Dames : notation officielle ; Ludo : « lancer:pion »). */
  moves: z.array(z.string()),
  outcome: z
    .object({
      /** Place par siège (clé = numéro de siège). */
      places: z.record(z.string(), z.number().int()),
      draw: z.boolean(),
      reason: z.string(),
    })
    .nullable(),
  stake: z.number().int().nonnegative(),
  pot: z.number().int().nonnegative(),
  ratingChanges: z.record(z.string(), RatingChangeSchema),
  settlement: MachineSettlementSchema.optional(),
  room: z
    .object({
      code: z.string(),
      format: z.enum(['simple', 'aller_retour', 'roi']),
      nextChallenger: z.object({ userId: z.string(), pseudo: z.string() }).optional(),
      leg: z.union([z.literal(1), z.literal(2)]).optional(),
    })
    .optional(),
  league: z.object({ leagueId: z.string(), matchId: z.string() }).optional(),
  dice: z.object({ commitment: z.string(), revealed: z.boolean() }).optional(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type GameSummary = z.infer<typeof GameSummarySchema>;
