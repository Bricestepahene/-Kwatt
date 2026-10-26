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
  /** Ludo : règles maison et équipes de la partie (rejeu exact, écran 19). */
  house: z.record(z.string(), z.string()).nullable().optional(),
  teams: z.array(z.array(z.number().int())).nullable().optional(),
  /** Dames : pendule de la partie. */
  clock: z.object({ initialMs: z.number().int(), incrementMs: z.number().int() }).nullable().optional(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type GameSummary = z.infer<typeof GameSummarySchema>;

/* ------------------------------------------------------------------ */
/* Dé vérifiable, parties en direct, pronostics (écrans 22 et 37)      */
/* ------------------------------------------------------------------ */

/**
 * GET /v1/games/:id/dice → preuve du dé (écran 22). Le secret (`serverSeed`) n'est publié
 * qu'à la fin de la partie ; avant, seule son empreinte (`commitment`) l'est.
 * Lancer de cauris (Pachisi) : `value` = nombre d'ouvertures vers le ciel, `pattern` le détail.
 */
export const DiceProofSchema = z.object({
  gameId: z.string(),
  kind: z.enum(['die', 'cowries']),
  commitment: z.string(),
  serverSeed: z.string().nullable(),
  rolls: z.array(
    z.object({
      rollIndex: z.number().int().nonnegative(),
      seat: z.number().int().nonnegative(),
      clientSeed: z.string(),
      value: z.number().int(),
      pattern: z.string().optional(),
      /** Lancer fait par la machine (siège machine ou tour joué à la place d'un absent). */
      byMachine: z.boolean(),
    }),
  ),
});
export type DiceProof = z.infer<typeof DiceProofSchema>;

/** Partie en cours, telle que la listent /regarder (37) et l'accueil (07). */
export const LiveGameSchema = z.object({
  id: z.string(),
  family: MachineFamilySchema,
  variant: z.string(),
  context: z.enum(['machine', 'room', 'league']),
  seats: z.array(GameSeatSchema),
  /** Dames : demi-coups joués ; Ludo : tour en cours. */
  progress: z.number().int().nonnegative(),
  spectators: z.number().int().nonnegative(),
  stake: z.number().int().nonnegative(),
  room: z.object({ code: z.string(), name: z.string() }).optional(),
  league: z.object({ leagueId: z.string(), name: z.string() }).optional(),
  startedAt: z.string().nullable(),
});
export type LiveGame = z.infer<typeof LiveGameSchema>;

/** GET /v1/games/live?family= → parties publiques en cours (salons et ligues). */
export const LiveGamesQuerySchema = z.object({ family: MachineFamilySchema.optional() });
export const LiveGamesResponseSchema = z.object({ items: z.array(LiveGameSchema) });
export type LiveGamesResponse = z.infer<typeof LiveGamesResponseSchema>;

/** GET /v1/games/mine → mes parties en cours (« Reprendre une partie », accueil 07). */
export const MyGamesResponseSchema = z.object({ items: z.array(LiveGameSchema.extend({ mySeat: z.number().int(), myTurn: z.boolean() })) });
export type MyGamesResponse = z.infer<typeof MyGamesResponseSchema>;

/** Pronostics (écran 37, D-09) : 50 cauris en pari mutuel, fermés au coup ou au tour 10. */
export const PredictionRequestSchema = z.object({ seat: z.number().int().min(0).max(5) });
export type PredictionRequest = z.infer<typeof PredictionRequestSchema>;

export const PredictionsViewSchema = z.object({
  open: z.boolean(),
  stake: z.number().int().positive(),
  /** Coup (Dames) ou tour (Ludo) après lequel les pronostics ferment. */
  closesAt: z.number().int(),
  /** Par siège : nombre de pronostics et cauris engagés. */
  pools: z.array(z.object({ seat: z.number().int(), count: z.number().int(), total: z.number().int() })),
  mine: z.object({ seat: z.number().int(), payout: z.number().int().nullable() }).nullable(),
  /** Le spectateur peut-il pronostiquer (profil de 18 ans et plus, pas joueur) ? */
  eligible: z.boolean(),
});
export type PredictionsView = z.infer<typeof PredictionsViewSchema>;

/** Réactions rapides (joueurs et spectateurs) : clés traduites par l'appli. */
export const GAME_REACTIONS = ['ekie', 'doucement', 'tu_dors', 'weee', 'bravo', 'revanche'] as const;
export const GameReactionSchema = z.enum(GAME_REACTIONS);
export type GameReaction = z.infer<typeof GameReactionSchema>;

/**
 * GET /v1/games/:id/watch → ce que voit un spectateur (37) : pronostics, réactions, file
 * « Défier le gagnant » du salon.
 */
export const WatchViewSchema = z.object({
  game: GameSummarySchema,
  spectators: z.number().int().nonnegative(),
  predictions: PredictionsViewSchema,
  reactions: z.array(z.object({ key: GameReactionSchema, count: z.number().int() })),
  /** Salon : la file d'attente (« Défier le gagnant ») et ma place dedans. */
  queue: z.object({ length: z.number().int(), myPosition: z.number().int().nullable(), code: z.string() }).nullable(),
});
export type WatchView = z.infer<typeof WatchViewSchema>;
