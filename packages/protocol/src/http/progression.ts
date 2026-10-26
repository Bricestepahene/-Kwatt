/**
 * Progression (équipe Communauté) : guerre des quartiers (écran 36), collection de cartes
 * (écran 39), médailles, série de jours et quêtes de la semaine (écran 40), Raisonnement en
 * bêta (écran 42). Profils seulement. Aucun texte affichable : des codes que l'appli traduit.
 *
 * Routes :
 *   GET    /v1/quarters/standings?scope=quarter|city|country → QuarterStandings
 *   GET    /v1/cards                       → CardCollection
 *   PUT    /v1/cards/equipped              EquipCardRequest → CardCollection
 *   GET    /v1/rewards                     → RewardsView
 *   POST   /v1/rewards/quests/:id/claim    → ClaimResult (grand livre, idempotent)
 *   POST   /v1/rewards/streak/choose       ChooseCardRequest → ClaimResult (carte rare au choix)
 *   GET    /v1/reasoning/waitlist          → ReasoningWaitlist
 *   POST   /v1/reasoning/waitlist          → ReasoningWaitlist (« Me prévenir à l'ouverture »)
 *   DELETE /v1/reasoning/waitlist          → ReasoningWaitlist
 *
 * Notifications : `quest.completed` { questId, amount? }, `rewards.card` { code },
 * `quarters.champion` { quarterId, season }.
 */
import { z } from 'zod';
import { IsoDateSchema } from './common.js';
import { FabricNameSchema, ItemRaritySchema, ProfileRankSchema } from './shop.js';

// --- Guerre des quartiers ------------------------------------------------------------------

export const QUARTER_SCOPES = ['quarter', 'city', 'country'] as const;
export const QuarterScopeSchema = z.enum(QUARTER_SCOPES);
export type QuarterScope = z.infer<typeof QuarterScopeSchema>;
export const QuarterStandingsQuerySchema = z.object({ scope: QuarterScopeSchema.default('quarter') });

export const QuarterStandingSchema = z.object({
  /** Quartier : son id ; ville : « CM:Douala » ; pays : « CM ». */
  key: z.string(),
  /** Nom du quartier (null : la ville entière), donnée jamais traduite. */
  name: z.string().nullable(),
  city: z.string().nullable(),
  /** Nom anglais de la ville quand il diffère. */
  cityEn: z.string().nullable(),
  /** Code pays ISO (l'appli traduit le nom du pays). */
  country: z.string(),
  players: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  position: z.number().int().positive(),
  /** Places gagnées (+) ou perdues (−) depuis ce matin ; null : pas de photo du matin. */
  trend: z.number().int().nullable(),
});
export type QuarterStanding = z.infer<typeof QuarterStandingSchema>;

export const QuarterStandingsSchema = z.object({
  season: z.string(),
  /** « Saison 3 ». */
  seasonNumber: z.number().int().positive(),
  /** « encore 9 jours » (jour courant compris). */
  daysLeft: z.number().int().nonnegative(),
  scope: QuarterScopeSchema,
  /** Ce que couvre la liste : la ville (quartiers) ou le pays (villes) ; null pour les pays. */
  area: z.object({ city: z.string().nullable(), cityEn: z.string().nullable(), country: z.string() }).nullable(),
  items: z.array(QuarterStandingSchema),
  /** Ton quartier (ou ta ville, ton pays) dans ce classement ; null sans quartier choisi. */
  mine: QuarterStandingSchema.nullable(),
  /** Tes points pour ton quartier cette saison. */
  myPoints: z.number().int().nonnegative(),
  /** Quartier champion de la saison précédente. */
  lastChampion: z.object({ key: z.string(), name: z.string().nullable(), city: z.string() }).nullable(),
});
export type QuarterStandings = z.infer<typeof QuarterStandingsSchema>;

// --- Cartes --------------------------------------------------------------------------------

export const CARD_TYPES = ['table', 'plateau', 'pions', 'pouvoir', 'trophee'] as const;
export const CardTypeSchema = z.enum(CARD_TYPES);
export type CardType = z.infer<typeof CardTypeSchema>;
export const CARD_SLOTS = ['board', 'pieces', 'dice'] as const;
export const CardSlotSchema = z.enum(CARD_SLOTS);
export type CardSlot = z.infer<typeof CardSlotSchema>;
/** Comment on obtient la carte (écran 39, carte verrouillée). */
export const CARD_SOURCES = ['start', 'rank', 'quest', 'streak', 'feat', 'trophy'] as const;
export const CardSourceSchema = z.enum(CARD_SOURCES);
export type CardSource = z.infer<typeof CardSourceSchema>;

export const CardSchema = z.object({
  code: z.string(),
  rarity: ItemRaritySchema,
  type: CardTypeSchema,
  /** Habillage équipable (plateau, pions, dé). */
  slot: CardSlotSchema.nullable(),
  game: z.enum(['dames', 'ludo', 'both']),
  fabric: FabricNameSchema,
  how: CardSourceSchema,
  /** Échelon qui la débloque (how = rank). */
  rank: ProfileRankSchema.nullable(),
  /** Victoire marquante (how = feat) : upset_dames, rafle_4, wins_10… */
  feat: z.string().nullable(),
  /** Trophée (how = trophy) : league_gold, league_silver, league_bronze, quarter_champion. */
  trophy: z.string().nullable(),
  /** Série plus longue que 7 jours (how = streak). */
  days: z.number().int().positive().nullable(),
  /** Effet d'une carte table ou pouvoir (code) ; table : limite de mise. */
  effect: z.string().nullable(),
  limit: z.number().int().positive().nullable(),
  /** Édition numérotée : exemplaires et déjà attribués. */
  edition: z.object({ total: z.number().int().positive(), given: z.number().int().nonnegative() }).nullable(),
  owned: z.boolean(),
  serial: z.number().int().positive().nullable(),
  equipped: z.boolean(),
  acquiredAt: IsoDateSchema.nullable(),
});
export type Card = z.infer<typeof CardSchema>;

export const CardCollectionSchema = z.object({
  owned: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  items: z.array(CardSchema),
  equipped: z.object({ board: z.string().nullable(), pieces: z.string().nullable(), dice: z.string().nullable() }),
});
export type CardCollection = z.infer<typeof CardCollectionSchema>;

export const EquipCardRequestSchema = z.object({ slot: CardSlotSchema, code: z.string().nullable() });
export type EquipCardRequest = z.infer<typeof EquipCardRequestSchema>;

// --- Récompenses ---------------------------------------------------------------------------

export const QuestRewardSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cauris'), amount: z.number().int().positive() }),
  z.object({ kind: z.literal('card'), rarity: ItemRaritySchema }),
]);

export const QuestViewSchema = z.object({
  /** Clé de traduction : quests.<id>. */
  id: z.string(),
  game: z.enum(['dames', 'ludo', 'any']),
  target: z.number().int().positive(),
  progress: z.number().int().nonnegative(),
  done: z.boolean(),
  claimed: z.boolean(),
  reward: QuestRewardSchema,
  /** Aller-retour : aller gagné, retour à jouer. */
  legWon: z.boolean().optional(),
});
export type QuestView = z.infer<typeof QuestViewSchema>;

export const TrophySchema = z.object({
  leagueId: z.string().nullable(),
  /** Nom de la ligue (donnée). */
  title: z.string(),
  kind: z.enum(['or', 'argent', 'bronze']),
  awardedAt: IsoDateSchema,
});
export type Trophy = z.infer<typeof TrophySchema>;

export const RewardsViewSchema = z.object({
  medals: z.object({ gold: z.number().int(), silver: z.number().int(), bronze: z.number().int() }),
  streak: z.object({
    /** Jours de suite au kwatt (0 si hier n'a pas été joué). */
    length: z.number().int().nonnegative(),
    best: z.number().int().nonnegative(),
    /** Jours avant la prochaine carte rare au choix. */
    daysToReward: z.number().int().positive(),
    /** Aujourd'hui compte déjà. */
    today: z.boolean(),
    /** Cartes rares au choix gagnées, à choisir (codes proposés). */
    rareChoices: z.number().int().nonnegative(),
    choices: z.array(z.string()),
  }),
  week: z.string(),
  /** Fin de la semaine (lundi 00:00, heure du Cameroun). */
  weekEndsAt: IsoDateSchema,
  quests: z.array(QuestViewSchema),
  trophies: z.array(TrophySchema),
});
export type RewardsView = z.infer<typeof RewardsViewSchema>;

export const ChooseCardRequestSchema = z.object({ code: z.string() });
export const ClaimResultSchema = z.object({
  rewards: RewardsViewSchema,
  /** Cauris reçus (quête), ou carte reçue. */
  cauris: z.number().int().nonnegative(),
  card: z.string().nullable(),
});
export type ClaimResult = z.infer<typeof ClaimResultSchema>;

// --- Raisonnement --------------------------------------------------------------------------

export const ReasoningWaitlistSchema = z.object({ joined: z.boolean(), count: z.number().int().nonnegative() });
export type ReasoningWaitlist = z.infer<typeof ReasoningWaitlistSchema>;
