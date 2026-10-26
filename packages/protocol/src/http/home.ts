/**
 * Accueil du hub (écran 07) : ce que l'écran ne trouve pas ailleurs, en une requête.
 * La force par jeu vient de GET /v1/ratings/me, le solde de GET /v1/wallet.
 *
 * Route (module serveur « home ») :
 *   GET /v1/home → HomeView (profil)
 */
import { z } from 'zod';
import { IsoDateSchema, UuidSchema } from './common.js';

export const HomeViewSchema = z.object({
  /** Notifications non lues. */
  unread: z.number().int().nonnegative(),
  /** « À faire maintenant » : parties où c'est ton tour + défis reçus en attente. */
  todo: z.number().int().nonnegative(),
  /** Salons ouverts (publics, en attente de joueurs) par jeu. */
  openRooms: z.object({ dames: z.number().int().nonnegative(), ludo: z.number().int().nonnegative() }),
  /** Ton prochain match de ligue. */
  nextMatch: z
    .object({
      leagueId: UuidSchema,
      leagueName: z.string(),
      game: z.enum(['dames', 'ludo']),
      matchId: UuidSchema,
      stage: z.enum(['league', 'group', 'knockout', 'decider']),
      round: z.number().int().positive(),
      /** Phase finale : tour (1 = premier) et nombre de tours, pour « demi-finale ». */
      level: z.number().int().nullable(),
      levels: z.number().int().nullable(),
      matchAt: IsoDateSchema,
      opponents: z.array(z.string()),
    })
    .nullable(),
  /** Partie en cours à reprendre (la plus récente). */
  resume: z
    .object({
      gameId: z.string(),
      family: z.enum(['dames', 'ludo']),
      variant: z.string(),
      myTurn: z.boolean(),
      where: z.string().nullable(),
      opponents: z.array(z.string()),
    })
    .nullable(),
  /** Ligue publique du moment (inscriptions ouvertes, la plus remplie). */
  publicLeague: z
    .object({
      id: UuidSchema,
      code: z.string(),
      name: z.string(),
      game: z.enum(['dames', 'ludo']),
      players: z.number().int().nonnegative(),
      maxPlaces: z.number().int().positive(),
      entry: z.number().int().nonnegative(),
      registrationClosesAt: IsoDateSchema.nullable(),
    })
    .nullable(),
});
export type HomeView = z.infer<typeof HomeViewSchema>;
