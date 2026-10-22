/**
 * Force par variante classée (contrat C1, SPEC §7) : façon Elo, départ à 900, niveau
 * = max(1, ⌊(force − 800) ÷ 40⌋), échelons Apprenti → Fon.
 *
 * Route :
 *   GET /v1/ratings/me → MyRatingsResponse (variantes déjà jouées seulement)
 */
import { z } from 'zod';
import { ProfileRankSchema } from './shop.js';

export const RATED_VARIANT_IDS = ['dames10', 'dames8', 'ludo_classique', 'ludo_rapide', 'ludo_six'] as const;
export const RatedVariantSchema = z.enum(RATED_VARIANT_IDS);
export type RatedVariantId = z.infer<typeof RatedVariantSchema>;

export const RatingItemSchema = z.object({
  variant: RatedVariantSchema,
  rating: z.number().int(),
  level: z.number().int().positive(),
  rank: ProfileRankSchema,
  gamesPlayed: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  /** « Encore 38 points pour Niv. 18 ». */
  pointsToNextLevel: z.number().int().nonnegative(),
});
export type RatingItem = z.infer<typeof RatingItemSchema>;

export const MyRatingsResponseSchema = z.object({ items: z.array(RatingItemSchema) });
export type MyRatingsResponse = z.infer<typeof MyRatingsResponseSchema>;

/** Variation de force d'un joueur après une partie classée (écran 18 : « Force Dames +18 »). */
export const RatingChangeSchema = z.object({
  before: z.number().int(),
  after: z.number().int(),
  delta: z.number().int(),
  levelBefore: z.number().int().positive(),
  levelAfter: z.number().int().positive(),
});
export type RatingChangeView = z.infer<typeof RatingChangeSchema>;
