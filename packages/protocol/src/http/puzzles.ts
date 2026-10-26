/**
 * Problème du jour (écran 19b) : un problème par jour du Cameroun (UTC+1), le même pour
 * tout le monde, tiré de @kwatt/engine-dames (`dailyPuzzle`).
 *
 * Routes (profils seulement) :
 *   GET  /v1/puzzles/daily?variant=dames10|dames8 → DailyPuzzleResponse
 *   POST /v1/puzzles/daily/solve  DailyPuzzleSolveRequest → DailyPuzzleSolveResponse
 *
 * Résolu : +10 cauris une fois par jour (grand livre, mouvement `daily_problem`), série de
 * jours ; tous les 7 jours de suite, une carte rare (si le catalogue en propose une).
 */
import { z } from 'zod';

export const PuzzleVariantSchema = z.enum(['dames10', 'dames8']);
export type PuzzleVariant = z.infer<typeof PuzzleVariantSchema>;

export const DayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DailyPuzzleQuerySchema = z.object({
  variant: PuzzleVariantSchema.default('dames10'),
});
export type DailyPuzzleQuery = z.infer<typeof DailyPuzzleQuerySchema>;

export const PUZZLE_THEMES = ['shot', 'coup_de_dame', 'rafle', 'capture_choice', 'win_material'] as const;

const SquaresSchema = z.array(z.number().int().min(1).max(50));

export const DailyPuzzleSchema = z.object({
  id: z.string(),
  variant: PuzzleVariantSchema,
  /** Camp qui joue et doit trouver. */
  side: z.enum(['w', 'b']),
  white: z.object({ men: SquaresSchema, kings: SquaresSchema }),
  black: z.object({ men: SquaresSchema, kings: SquaresSchema }),
  /**
   * Suite forcée en notation officielle : coups du joueur et réponses forcées du défenseur
   * (jouées par l'appli). Le serveur revalide la solution envoyée.
   */
  solution: z.array(z.string()),
  difficulty: z.number().int().min(1).max(5),
  theme: z.enum(PUZZLE_THEMES),
});
export type DailyPuzzle = z.infer<typeof DailyPuzzleSchema>;

export const DailyPuzzleResponseSchema = z.object({
  /** Jour du Cameroun « AAAA-MM-JJ ». */
  dayKey: DayKeySchema,
  puzzle: DailyPuzzleSchema,
  /** Déjà résolu aujourd'hui (toutes variantes confondues : une récompense par jour). */
  solved: z.boolean(),
  /** Série de jours en cours (0 si hier n'a pas été résolu). */
  streak: z.number().int().nonnegative(),
  /** Jours restants avant la prochaine carte rare (« au 7e jour »). */
  daysToReward: z.number().int().min(1).max(7),
  reward: z.number().int().nonnegative(),
  /** Part des joueurs qui ont trouvé aujourd'hui (0 à 100), null s'il y a trop peu d'essais. */
  solvedShare: z.number().int().min(0).max(100).nullable(),
  /** Thème du problème de demain (« Demain : un coup de dame »). */
  tomorrowTheme: z.enum(PUZZLE_THEMES),
});
export type DailyPuzzleResponse = z.infer<typeof DailyPuzzleResponseSchema>;

export const DailyPuzzleSolveRequestSchema = z.object({
  dayKey: DayKeySchema,
  variant: PuzzleVariantSchema.default('dames10'),
  /** Coups du joueur (notation officielle), ou toute la suite (réponses comprises). */
  moves: z.array(z.string().min(3).max(80)).min(1).max(40),
});
export type DailyPuzzleSolveRequest = z.input<typeof DailyPuzzleSolveRequestSchema>;

export const DailyPuzzleSolveResponseSchema = z.object({
  correct: z.boolean(),
  /** Cauris gagnés par cette résolution (0 si déjà résolu aujourd'hui ou faux). */
  reward: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
  daysToReward: z.number().int().min(1).max(7),
  /** Code de la carte rare gagnée (série de 7 jours), sinon null. */
  card: z.string().nullable(),
  alreadySolved: z.boolean(),
});
export type DailyPuzzleSolveResponse = z.infer<typeof DailyPuzzleSolveResponseSchema>;
