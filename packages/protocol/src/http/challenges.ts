/**
 * Défis avec mise entre amis (écran 26, /defi/nouveau et /defi/[id]).
 *
 *   GET  /v1/challenges/cap?userId=&variant=  → StakeCapView (plafond avant de défier)
 *   POST /v1/challenges        CreateChallengeRequest → ChallengeView (notification au défié)
 *   GET  /v1/challenges        → { items: ChallengeView[] } (défis en attente, reçus et envoyés)
 *   GET  /v1/challenges/:id    → ChallengeView
 *   POST /v1/challenges/:id/accept   → ChallengeView (mises bloquées, salon et partie créés)
 *   POST /v1/challenges/:id/counter  { stake } → ChallengeView (l'autre doit répondre)
 *   POST /v1/challenges/:id/decline  → ChallengeView
 *   POST /v1/challenges/:id/cancel   → ChallengeView (l'auteur retire son défi)
 *
 * Un défi expire 2 h après la dernière proposition. Mise > 0 : profils de 18 ans et plus,
 * jamais deux comptes du même appareil, plafond min(25 % du plus petit solde, limite de table).
 */
import { z } from 'zod';
import { UuidSchema } from './common.js';
import { RoomClockSchema, RoomGameSchema } from './rooms.js';

export const CHALLENGE_TTL_MS = 2 * 60 * 60 * 1000;
export const CHALLENGE_FORMATS = ['simple', 'aller_retour'] as const;
export const ChallengeFormatSchema = z.enum(CHALLENGE_FORMATS);
export type ChallengeFormat = z.infer<typeof ChallengeFormatSchema>;

export const CHALLENGE_STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'expired'] as const;
export const ChallengeStatusSchema = z.enum(CHALLENGE_STATUSES);
export type ChallengeStatus = z.infer<typeof ChallengeStatusSchema>;

export const StakeCapViewSchema = z.object({
  /** Mise maximale par joueur (0 : pas de mise possible). */
  max: z.number().int().nonnegative(),
  balanceCap: z.number().int().nonnegative(),
  tableLimit: z.number().int().nonnegative(),
  limitedBy: z.enum(['balance', 'table']),
  myBalance: z.number().int(),
  /** Pourquoi on ne peut pas miser (stake.underage, stake.same_device…) ; null : on peut. */
  refusal: z.string().nullable(),
});
export type StakeCapView = z.infer<typeof StakeCapViewSchema>;

export const StakeCapQuerySchema = z.object({ userId: UuidSchema, variant: z.string().min(1).max(32) });

export const CreateChallengeRequestSchema = z.object({
  toUserId: UuidSchema,
  game: RoomGameSchema,
  variant: z.string().min(1).max(32),
  stake: z.number().int().nonnegative(),
  format: ChallengeFormatSchema,
  clock: RoomClockSchema.optional(),
  /** Revanche d'une partie (écran 18). */
  rematchOf: UuidSchema.optional(),
});
export type CreateChallengeRequest = z.infer<typeof CreateChallengeRequestSchema>;

export const ChallengeCounterRequestSchema = z.object({ stake: z.number().int().nonnegative() });

const ChallengePlayerSchema = z.object({ userId: UuidSchema, pseudo: z.string(), avatar: z.unknown().nullable() });

export const ChallengeViewSchema = z.object({
  id: UuidSchema,
  from: ChallengePlayerSchema,
  to: ChallengePlayerSchema,
  game: RoomGameSchema,
  variant: z.string(),
  format: ChallengeFormatSchema,
  clock: RoomClockSchema.nullable(),
  stake: z.number().int().nonnegative(),
  status: ChallengeStatusSchema,
  /** Joueur qui doit répondre à la dernière proposition. */
  awaiting: UuidSchema.nullable(),
  /** Contre-proposition en cours. */
  countered: z.boolean(),
  rematchOf: UuidSchema.nullable(),
  /** Plafond vu par le lecteur (null si la mise est impossible entre eux). */
  cap: StakeCapViewSchema,
  expiresAt: z.string(),
  gameId: UuidSchema.nullable(),
  roomCode: z.string().nullable(),
  createdAt: z.string(),
});
export type ChallengeView = z.infer<typeof ChallengeViewSchema>;

export const ChallengeListResponseSchema = z.object({ items: z.array(ChallengeViewSchema) });
export type ChallengeListResponse = z.infer<typeof ChallengeListResponseSchema>;
