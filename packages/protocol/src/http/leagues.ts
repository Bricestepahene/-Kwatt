/**
 * Ligues (écrans 27 à 35, 28b, 34b ; planches RegleLigues et RegleCompet).
 *
 *   GET    /v1/leagues?scope=mine|public&game=all|dames|ludo     → LeagueListResponse
 *   POST   /v1/leagues                                            CreateLeagueRequest → LeagueDetail (201)
 *   GET    /v1/leagues/by-code/:code                              → LeagueDetail (session : invité ou profil)
 *   GET    /v1/leagues/:id                                        → LeagueDetail
 *   POST   /v1/leagues/:id/join                                   → LeagueDetail (entrée bloquée tout de suite)
 *   POST   /v1/leagues/:id/leave                                  → LeagueDetail (avant le début : entrée rendue)
 *   DELETE /v1/leagues/:id/members/:userId                        → LeagueDetail (créateur, avant validation)
 *   POST   /v1/leagues/:id/start                                  → LeagueDetail (ligue privée : le créateur lance)
 *   POST   /v1/leagues/:id/validate                               → LeagueDetail (ligue publique : sous 48 h)
 *   POST   /v1/leagues/:id/cancel                                 → LeagueDetail (créateur)
 *   GET    /v1/leagues/:id/matches/:matchId                       → LeagueMatchView (écrans 34 et 34b)
 *   POST   /v1/leagues/:id/matches/:matchId/time   {time}         → LeagueMatchView
 *   POST   /v1/leagues/:id/matches/:matchId/board  {board}        → LeagueMatchView
 *   POST   /v1/leagues/:id/matches/:matchId/arrive                → LeagueMatchView (gameId dès que tous sont là)
 *   GET    /v1/leagues/:id/exclusions/:userId                     → LeagueExclusionView (écran 35)
 *
 * Le serveur ne renvoie que des données et des codes : le nom de la ligue est saisi par
 * son créateur et n'est jamais traduit.
 */
import { z } from 'zod';
import { IsoDateSchema, UuidSchema } from './common.js';
import { PlayerLookSchema } from './profiles.js';
import { DayKeySchema } from './puzzles.js';

/** Code d'invitation : même alphabet que les salons (sans 0, O, 1, I), 6 caractères. */
export const LEAGUE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const LeagueCodeSchema = z.string().regex(LEAGUE_CODE_PATTERN);

export const LeagueGameSchema = z.enum(['dames', 'ludo']);
export type LeagueGame = z.infer<typeof LeagueGameSchema>;
export const LeagueAccessSchema = z.enum(['private', 'public']);
export type LeagueAccess = z.infer<typeof LeagueAccessSchema>;
/** Championnat (tous contre tous) ou coupe (poules puis phase finale). */
export const LeagueFormatSchema = z.enum(['championship', 'cup']);
export type LeagueFormat = z.infer<typeof LeagueFormatSchema>;
/**
 * registration : inscriptions ouvertes · awaiting_validation : inscriptions closes, le créateur
 * valide sous 48 h (publique) · running : en cours · finished · cancelled.
 */
export const LeagueStatusSchema = z.enum(['registration', 'awaiting_validation', 'running', 'finished', 'cancelled']);
export type LeagueStatus = z.infer<typeof LeagueStatusSchema>;
export const LeagueRhythmSchema = z.enum(['daily', 'weekly']);
export type LeagueRhythm = z.infer<typeof LeagueRhythmSchema>;

export const LEAGUE_BOARDS = ['dames10', 'dames8', 'ludo_classique', 'ludo_rapide', 'ludo_six', 'ludo_parchis', 'ludo_pachisi'] as const;
export const LeagueBoardSchema = z.enum(LEAGUE_BOARDS);
export type LeagueBoard = z.infer<typeof LeagueBoardSchema>;
/** Les 4 règles de la planche (écran 28b) : imposée, qui reçoit, une par journée, commun accord. */
export const BoardPolicySchema = z.enum(['imposed', 'home', 'rotation', 'agreement']);
export type BoardPolicy = z.infer<typeof BoardPolicySchema>;
export const BoardRulesSchema = z.object({
  policy: BoardPolicySchema,
  allowed: z.array(LeagueBoardSchema).min(1).max(7),
  defaultBoard: LeagueBoardSchema,
});
export type BoardRulesView = z.infer<typeof BoardRulesSchema>;

export const RANK_ID_VALUES = ['apprenti', 'debrouillard', 'ancien', 'notable', 'chef', 'fon'] as const;
export const LeagueRankSchema = z.enum(RANK_ID_VALUES);

/** Créneaux proposés pour l'heure du match (écran 34). */
export const LEAGUE_TIME_SLOTS = ['18:00', '19:30', '20:00', '21:30'] as const;
export const MatchTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const CreateLeagueRequestSchema = z.object({
  /** Nom saisi par le créateur (jamais traduit). */
  name: z.string().trim().min(3).max(40),
  game: LeagueGameSchema,
  access: LeagueAccessSchema,
  format: LeagueFormatSchema,
  /** Places max. : 2 à 64 (publique : 4 à 64, de 2 en 2). */
  maxPlaces: z.number().int().min(2).max(64),
  /** Droit d'entrée en cauris (0 = gratuite ; publique : 50 à 1 000, de 50 en 50). */
  entry: z.number().int().min(0).max(1000),
  minRank: LeagueRankSchema.nullable().default(null),
  /** Championnat : aller-retour (privée) ou aller simple. */
  doubleRound: z.boolean().default(false),
  /** Coupe : nombre de poules et qualifiés par poule (1 ou 2). */
  groups: z.number().int().min(1).max(8).optional(),
  qualifiersPerGroup: z.number().int().min(1).max(2).optional(),
  /** Ludo : nombre de journées (tables recomposées chaque journée). */
  rounds: z.number().int().min(1).max(60).optional(),
  /** Relégués affichés au bas du classement (planche Championnat). */
  relegated: z.number().int().min(0).max(8).default(0),
  boardRules: BoardRulesSchema,
  /** Heure par défaut des matchs (heure du Cameroun). */
  defaultTime: MatchTimeSchema.default('20:00'),
  rhythm: LeagueRhythmSchema.default('daily'),
  /** Premier jour de match (AAAA-MM-JJ, heure du Cameroun). */
  firstDay: DayKeySchema,
  /** Publique : fin des inscriptions (ISO). */
  registrationClosesAt: IsoDateSchema.optional(),
});
export type CreateLeagueRequest = z.input<typeof CreateLeagueRequestSchema>;
export type CreateLeagueBody = z.output<typeof CreateLeagueRequestSchema>;

export const LeagueListQuerySchema = z.object({
  scope: z.enum(['mine', 'public']).default('mine'),
  game: z.enum(['all', 'dames', 'ludo']).default('all'),
});
export type LeagueListQuery = z.infer<typeof LeagueListQuerySchema>;

export const LeaguePlayerSchema = z.object({
  userId: UuidSchema,
  /** Pseudo, ou nom de partie d'un invité. */
  pseudo: z.string(),
  avatar: PlayerLookSchema.nullable(),
});
export type LeaguePlayer = z.infer<typeof LeaguePlayerSchema>;

/** Carte de l'écran 27. */
export const LeagueCardSchema = z.object({
  id: UuidSchema,
  code: LeagueCodeSchema,
  name: z.string(),
  game: LeagueGameSchema,
  access: LeagueAccessSchema,
  format: LeagueFormatSchema,
  status: LeagueStatusSchema,
  players: z.number().int().nonnegative(),
  maxPlaces: z.number().int(),
  entry: z.number().int().nonnegative(),
  minRank: LeagueRankSchema.nullable(),
  currentRound: z.number().int().nonnegative(),
  totalRounds: z.number().int().nonnegative(),
  doubleRound: z.boolean(),
  groups: z.number().int().nullable(),
  /** Ta place (mes ligues), sinon null. */
  myPosition: z.number().int().nullable(),
  /** Places restantes (publiques). */
  placesLeft: z.number().int().nonnegative(),
  registrationClosesAt: IsoDateSchema.nullable(),
});
export type LeagueCard = z.infer<typeof LeagueCardSchema>;
export const LeagueListResponseSchema = z.object({ items: z.array(LeagueCardSchema) });
export type LeagueListResponse = z.infer<typeof LeagueListResponseSchema>;

export const StandingRowSchema = z.object({
  player: LeaguePlayerSchema,
  position: z.number().int().positive(),
  played: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  forfeits: z.number().int().nonnegative(),
  penalties: z.number().int().nonnegative(),
  points: z.number().int(),
  /** Dames : différence de pions ; Ludo : pions rentrés. */
  tiebreak: z.number().int(),
  excluded: z.boolean(),
  /** Zone de la planche Championnat. */
  zone: z.enum(['champion', 'podium', 'relegation', 'none']),
});
export type StandingRowView = z.infer<typeof StandingRowSchema>;

/** Résultat d'un match (Dames) : vu du joueur à domicile. */
export const LeagueMatchOutcomeSchema = z.enum([
  'home_win',
  'away_win',
  'draw',
  'home_forfeit',
  'away_forfeit',
  'double_forfeit',
  'home_awarded',
  'away_awarded',
]);
export const LeagueMatchStatusSchema = z.enum(['scheduled', 'playing', 'played', 'annulled', 'cancelled']);
export type LeagueMatchStatus = z.infer<typeof LeagueMatchStatusSchema>;
export const LeagueStageSchema = z.enum(['league', 'group', 'knockout', 'decider']);

export const LeagueMatchCardSchema = z.object({
  id: UuidSchema,
  stage: LeagueStageSchema,
  round: z.number().int().positive(),
  /** Coupe : poule (0 = A) ou rencontre de la phase finale, aller (1) / retour (2). */
  group: z.number().int().nullable(),
  tie: z.number().int().nullable(),
  leg: z.number().int().nullable(),
  day: DayKeySchema,
  matchAt: IsoDateSchema,
  /** Joueurs : Dames [domicile, extérieur] ; Ludo : la table. */
  players: z.array(LeaguePlayerSchema),
  board: LeagueBoardSchema.nullable(),
  status: LeagueMatchStatusSchema,
  outcome: LeagueMatchOutcomeSchema.nullable(),
  /** Ludo : place de chacun (1 = premier), forfait = null. */
  places: z.record(z.string(), z.number().int().nullable()).nullable(),
  /** Heure fixée d'un commun accord (sinon l'heure par défaut). */
  timeAgreed: z.boolean(),
  gameId: z.string().nullable(),
});
export type LeagueMatchCard = z.infer<typeof LeagueMatchCardSchema>;

export const KnockoutTieSchema = z.object({
  tie: z.number().int().nonnegative(),
  /** Tour de la phase finale : 1 = premier tour (souvent les demi-finales). */
  level: z.number().int().positive(),
  /** Nombre de rencontres à ce tour (2 = demi-finales, 1 = finale). */
  tiesAtLevel: z.number().int().positive(),
  first: LeaguePlayerSchema,
  second: LeaguePlayerSchema,
  /** Libellé de tête de série : « A1 », « B2 »… ou null. */
  firstSeed: z.string().nullable(),
  secondSeed: z.string().nullable(),
  firstScore: z.number().int(),
  secondScore: z.number().int(),
  winner: UuidSchema.nullable(),
  deciderNeeded: z.boolean(),
  matches: z.array(LeagueMatchCardSchema),
});
export type KnockoutTie = z.infer<typeof KnockoutTieSchema>;

export const LeagueGroupSchema = z.object({
  index: z.number().int().nonnegative(),
  rows: z.array(StandingRowSchema),
  qualifiers: z.array(UuidSchema),
});
export type LeagueGroup = z.infer<typeof LeagueGroupSchema>;

export const LeagueMemberSchema = z.object({
  player: LeaguePlayerSchema,
  status: z.enum(['active', 'excluded']),
  joinedAt: IsoDateSchema,
});

export const LeaguePrizesSchema = z.object({
  first: z.number().int(),
  second: z.number().int(),
  third: z.number().int(),
  participationEach: z.number().int(),
  creator: z.number().int(),
});

export const LeagueDetailSchema = z.object({
  id: UuidSchema,
  code: LeagueCodeSchema,
  name: z.string(),
  game: LeagueGameSchema,
  access: LeagueAccessSchema,
  format: LeagueFormatSchema,
  status: LeagueStatusSchema,
  creator: LeaguePlayerSchema,
  maxPlaces: z.number().int(),
  minPlayers: z.number().int(),
  entry: z.number().int(),
  /** Ligue publique : caution du créateur (rendue à la fin). */
  caution: z.number().int(),
  /** Pot ou cagnotte en ce moment (bonus Kwatt compris une fois la ligue validée). */
  pot: z.number().int(),
  /** Pot si la ligue est complète (publique, bonus compris). */
  potIfFull: z.number().int(),
  prizes: LeaguePrizesSchema,
  minRank: LeagueRankSchema.nullable(),
  boardRules: BoardRulesSchema,
  defaultTime: MatchTimeSchema,
  rhythm: LeagueRhythmSchema,
  doubleRound: z.boolean(),
  groups: z.number().int().nullable(),
  qualifiersPerGroup: z.number().int().nullable(),
  relegated: z.number().int(),
  firstDay: DayKeySchema,
  /** Dernier jour prévu (calendrier tiré, sinon prévision). */
  endDay: DayKeySchema,
  totalRounds: z.number().int(),
  totalMatches: z.number().int(),
  matchesPerRound: z.number().int(),
  currentRound: z.number().int(),
  registrationClosesAt: IsoDateSchema.nullable(),
  /** Publique : limite de validation (48 h après la clôture des inscriptions). */
  validationDeadline: IsoDateSchema.nullable(),
  /** Graine du tirage au sort (publiée une fois la ligue lancée). */
  drawSeed: z.string().nullable(),
  members: z.array(LeagueMemberSchema),
  standings: z.array(StandingRowSchema),
  groupTables: z.array(LeagueGroupSchema),
  knockout: z.array(KnockoutTieSchema),
  /** Matchs de la journée en cours (ou de la journée 1 juste après le tirage). */
  roundMatches: z.array(LeagueMatchCardSchema),
  exclusions: z.array(z.object({ player: LeaguePlayerSchema, at: IsoDateSchema })),
  me: z.object({
    member: z.boolean(),
    creator: z.boolean(),
    excluded: z.boolean(),
    /** Refus d'inscription (code d'erreur) si tu ne peux pas t'inscrire, sinon null. */
    joinRefusal: z.string().nullable(),
    nextMatch: LeagueMatchCardSchema.nullable(),
    balance: z.number().int().nullable(),
  }),
  medals: z.array(z.object({ player: LeaguePlayerSchema, kind: z.enum(['or', 'argent', 'bronze']) })),
});
export type LeagueDetail = z.infer<typeof LeagueDetailSchema>;

export const SetMatchTimeRequestSchema = z.object({ time: MatchTimeSchema });
export const SetMatchBoardRequestSchema = z.object({ board: LeagueBoardSchema });

/** Écran 34 (et 34b) : un match vu par l'un de ses joueurs. */
export const LeagueMatchViewSchema = z.object({
  league: z.object({ id: UuidSchema, code: LeagueCodeSchema, name: z.string(), game: LeagueGameSchema, format: LeagueFormatSchema, entry: z.number().int() }),
  match: LeagueMatchCardSchema,
  /** Fin de la journée (24 h). */
  dayEndsAt: IsoDateSchema,
  /** Ce que chacun propose comme heure (null = rien). */
  timeProposals: z.record(z.string(), MatchTimeSchema.nullable()),
  defaultTime: MatchTimeSchema,
  slots: z.array(MatchTimeSchema),
  /** On peut encore changer l'heure ou la planche (jusqu'à 1 h / 24 h avant). */
  timeEditable: z.boolean(),
  boardRules: BoardRulesSchema,
  /** Écran 34b : qui choisit, et les choix déjà faits. */
  boardChooser: z.enum(['organizer', 'me', 'opponent', 'both', 'calendar']),
  boardChoices: z.record(z.string(), LeagueBoardSchema.nullable()),
  boardDeadline: IsoDateSchema,
  /** Planche de l'aller (retour d'une coupe) et qui l'a choisie. */
  firstLegBoard: LeagueBoardSchema.nullable(),
  /** Force de chacun sur chaque planche permise (écran 34b) et chances de gagner. */
  boardOdds: z.array(z.object({ board: LeagueBoardSchema, ratings: z.record(z.string(), z.number().int()), myWinChance: z.number().min(0).max(1).nullable() })),
  /** Arrivées dans la salle. */
  arrivals: z.record(z.string(), IsoDateSchema.nullable()),
  /** Ouverture de la salle (15 min avant) et forfait (10 min après). */
  roomOpensAt: IsoDateSchema,
  forfeitAt: IsoDateSchema,
  /** Pour chacun : place au classement et forfaits (« 9e · forfait hier »). */
  players: z.array(
    z.object({
      player: LeaguePlayerSchema,
      position: z.number().int().nullable(),
      forfeits: z.number().int(),
      /** A fait forfait à la journée précédente : un second forfait l'exclurait. */
      forfeitedLastRound: z.boolean(),
    }),
  ),
  fine: z.number().int(),
});
export type LeagueMatchView = z.infer<typeof LeagueMatchViewSchema>;

/** Écran 35 : exclusion d'un joueur et recalcul. */
export const LeagueExclusionViewSchema = z.object({
  league: z.object({ id: UuidSchema, code: LeagueCodeSchema, name: z.string(), game: LeagueGameSchema, entry: z.number().int() }),
  excluded: LeaguePlayerSchema,
  at: IsoDateSchema,
  /** Journée de l'exclusion. */
  round: z.number().int(),
  /** Forfaits qui ont mené à l'exclusion (journées). */
  forfeitRounds: z.array(z.number().int()),
  /** 2 de suite ou 3 au total. */
  reason: z.enum(['consecutive', 'total']),
  policy: z.enum(['annulled', 'kept']),
  elapsed: z.number().int(),
  totalMatches: z.number().int(),
  remainingPlayers: z.number().int(),
  /** Résultats annulés ou attribués : effet pour chaque adversaire, en points. */
  changes: z.array(
    z.object({
      player: LeaguePlayerSchema,
      round: z.number().int(),
      /** Résultat d'origine, vu de cet adversaire : win, draw, loss, forfeit_win ; awarded = victoire 1–0 attribuée. */
      result: z.enum(['win', 'draw', 'loss', 'forfeit_win', 'awarded']),
      points: z.number().int(),
    }),
  ),
  /** Ton classement avant et après (null si tu n'es pas dans la ligue). */
  myPosition: z.object({ before: z.number().int(), after: z.number().int() }).nullable(),
  calendar: z.object({
    mode: z.enum(['bye', 'repacked']),
    rested: z.array(z.object({ round: z.number().int(), player: LeaguePlayerSchema })),
    remainingMatches: z.number().int(),
    matchesPerRound: z.number().int(),
    endDayBefore: DayKeySchema,
    endDayAfter: DayKeySchema,
    /** Ton calendrier a changé. */
    mineChanged: z.boolean(),
  }),
  money: z.object({ refund: z.number().int(), remaining: z.number().int(), fines: z.number().int(), potBefore: z.number().int(), potAfter: z.number().int() }),
});
export type LeagueExclusionView = z.infer<typeof LeagueExclusionViewSchema>;
