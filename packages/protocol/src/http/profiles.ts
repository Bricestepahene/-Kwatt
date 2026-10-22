/**
 * Profil unique (écran 09), avatar et photo (écran 10), profil public d'un autre joueur.
 *
 * Routes :
 *   GET    /v1/me/profile        → Profile (ton profil, avec ton solde et ta photo en vérification)
 *   GET    /v1/profiles/:userId  → Profile (profil public ; compte jeune invisible des inconnus : 404)
 *   GET    /v1/me/avatar         → MyAvatar
 *   PUT    /v1/me/avatar         SaveAvatarRequest → MyAvatar (pièces non possédées : 409 avatar.not_owned)
 *   POST   /v1/me/photo          multipart, champ « photo » (JPEG, PNG, WebP, HEIC) → MyAvatar
 *   DELETE /v1/me/photo          → MyAvatar
 *   GET    /v1/admin/photos      ?status=pending → { items: PhotoReviewItem[] } (ADMIN_TOKEN)
 *   POST   /v1/admin/photos/:userId/approve | /reject → { ok: true } (ADMIN_TOKEN)
 *
 * Photo : recadrée en 512×512 WebP par le serveur, modérée avant d'être montrée aux autres
 * (D-10 ; PHOTO_AUTO_APPROVE=true l'approuve d'office). Tant qu'elle n'est pas approuvée,
 * les autres voient l'avatar ; toi, tu la vois avec la mention « en vérification ».
 */
import { z } from 'zod';
import { IsoDateSchema, UuidSchema } from './common.js';
import {
  FabricNameSchema,
  HatRenderSchema,
  ItemCodeSchema,
  ItemRaritySchema,
  ProfileRankSchema,
  SkinToneSchema,
} from './shop.js';

// --- Apparence d'un joueur (ce que les autres voient) ----------------------------------

/**
 * Image de profil prête à dessiner (composant Avatar de l'appli) :
 * - `initial` : la première lettre du pseudo ;
 * - `composed` : teint, coiffe, tenue choisis au Studio ;
 * - `preset` : avatar prêt de la boutique (composition fixe sur un fond de tissu) ;
 * - `photo` : photo approuvée (ou la tienne, en vérification, sur ton propre profil).
 */
export const AvatarViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('initial') }),
  z.object({
    kind: z.literal('composed'),
    skin: SkinToneSchema,
    hat: HatRenderSchema.nullable(),
    outfit: FabricNameSchema,
  }),
  z.object({
    kind: z.literal('preset'),
    code: ItemCodeSchema,
    skin: SkinToneSchema,
    hat: HatRenderSchema.nullable(),
    outfit: FabricNameSchema,
    background: FabricNameSchema,
  }),
  z.object({ kind: z.literal('photo'), url: z.string().url() }),
]);
export type AvatarView = z.infer<typeof AvatarViewSchema>;

/** Cadre de tissu autour de l'avatar ou de la photo. */
export const FrameViewSchema = z.object({
  code: ItemCodeSchema,
  fabric: FabricNameSchema,
  rarity: ItemRaritySchema,
});
export type FrameView = z.infer<typeof FrameViewSchema>;

/**
 * Apparence d'un joueur : à reprendre partout où un joueur s'affiche (sièges d'une partie,
 * amis, classements). Côté serveur : `loadLooks(db, userIds, viewerId)` du module profiles.
 */
export const PlayerLookSchema = z.object({
  avatar: AvatarViewSchema,
  frame: FrameViewSchema.nullable(),
});
export type PlayerLook = z.infer<typeof PlayerLookSchema>;

/** Apparence quand on ne sait rien (invité, compte effacé) : l'initiale, sans cadre. */
export const DEFAULT_LOOK: PlayerLook = { avatar: { kind: 'initial' }, frame: null };

// --- Avatar et photo (Studio, écran 10) ------------------------------------------------

/** Ce que le joueur a choisi au Studio (des codes d'objets). */
export const AvatarSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('initial') }),
  z.object({
    kind: z.literal('composed'),
    skin: ItemCodeSchema,
    /** null : « Aucune » coiffe. */
    hat: ItemCodeSchema.nullable(),
    outfit: ItemCodeSchema,
  }),
  z.object({ kind: z.literal('preset'), preset: ItemCodeSchema }),
]);
export type AvatarSelection = z.infer<typeof AvatarSelectionSchema>;

/** Image montrée aux autres : l'avatar, ou la photo une fois approuvée. */
export const AVATAR_MODES = ['avatar', 'photo'] as const;
export const AvatarModeSchema = z.enum(AVATAR_MODES);
export type AvatarMode = z.infer<typeof AvatarModeSchema>;

export const PHOTO_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const PhotoStatusSchema = z.enum(PHOTO_STATUSES);
export type PhotoStatus = z.infer<typeof PhotoStatusSchema>;

/** Ta photo : en vérification, approuvée, ou refusée (le fichier refusé est supprimé). */
export const PhotoStateSchema = z.object({
  status: PhotoStatusSchema,
  /** null si la photo a été refusée. */
  url: z.string().url().nullable(),
  uploadedAt: IsoDateSchema,
  reviewedAt: IsoDateSchema.nullable(),
});
export type PhotoState = z.infer<typeof PhotoStateSchema>;

/** Côté d'une photo enregistrée (carré WebP). */
export const PHOTO_SIZE = 512;
/** Côté minimal d'une photo envoyée. */
export const PHOTO_MIN_SIZE = 128;
/** Formats acceptés à l'envoi (le serveur convertit en WebP). */
export const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;

/** GET/PUT /v1/me/avatar, POST/DELETE /v1/me/photo */
export const MyAvatarSchema = z.object({
  mode: AvatarModeSchema,
  selection: AvatarSelectionSchema,
  /** Code du cadre choisi (null : sans cadre). */
  frame: ItemCodeSchema.nullable(),
  photo: PhotoStateSchema.nullable(),
  /** Ce que les autres voient (la photo seulement une fois approuvée). */
  look: PlayerLookSchema,
  /** Ce que tu vois de toi (ta photo même en vérification). */
  ownLook: PlayerLookSchema,
});
export type MyAvatar = z.infer<typeof MyAvatarSchema>;

/**
 * PUT /v1/me/avatar : champs absents = inchangés. Les pièces doivent être à toi
 * (sinon 409 avatar.not_owned avec la liste et le prix total : l'appli propose l'achat).
 */
export const SaveAvatarRequestSchema = z
  .object({
    mode: AvatarModeSchema.optional(),
    selection: AvatarSelectionSchema.optional(),
    /** null : retirer le cadre. */
    frame: ItemCodeSchema.nullable().optional(),
  })
  .strict();
export type SaveAvatarRequest = z.infer<typeof SaveAvatarRequestSchema>;

/** Une photo à modérer (GET /v1/admin/photos). */
export const PhotoReviewItemSchema = z.object({
  userId: UuidSchema,
  pseudo: z.string(),
  status: PhotoStatusSchema,
  url: z.string().url().nullable(),
  uploadedAt: IsoDateSchema,
  reviewedAt: IsoDateSchema.nullable(),
});
export type PhotoReviewItem = z.infer<typeof PhotoReviewItemSchema>;

/** Notifications envoyées au joueur après la modération de sa photo. */
export const PROFILE_NOTIFICATION_KINDS = ['profile.photo_approved', 'profile.photo_rejected'] as const;

// --- Profil (écran 09) ------------------------------------------------------------------

export const GAME_FAMILIES = ['dames', 'ludo', 'raisonnement'] as const;
export const GameFamilySchema = z.enum(GAME_FAMILIES);
export type GameFamily = z.infer<typeof GameFamilySchema>;

/** Niveau dans une variante classée (force façon Elo, SPEC §7). */
export const VariantStandingSchema = z.object({
  variant: z.string(),
  rating: z.number().int(),
  level: z.number().int().positive(),
  rank: ProfileRankSchema,
  gamesPlayed: z.number().int().nonnegative(),
  /** Avancée dans le niveau courant, de 0 à 1 (barre de progression). */
  progress: z.number().min(0).max(1),
  nextLevel: z.number().int().positive(),
  /** « Encore 38 points de force pour Niv. 18 ». */
  pointsToNextLevel: z.number().int().nonnegative(),
});
export type VariantStanding = z.infer<typeof VariantStandingSchema>;

export const GameRecordSchema = z.object({
  wins: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
});
export type GameRecord = z.infer<typeof GameRecordSchema>;

export const RecentOpponentSchema = z.object({
  /** null : la machine, ou un compte effacé. */
  userId: UuidSchema.nullable(),
  /** Nom affiché dans la partie ; '' pour un compte effacé (l'appli écrit « Joueur parti »). */
  name: z.string(),
  machine: z.boolean(),
});
export type RecentOpponent = z.infer<typeof RecentOpponentSchema>;

/** Une ligne de « Derniers matchs ». */
export const RecentGameSchema = z.object({
  gameId: UuidSchema,
  variant: z.string(),
  context: z.enum(['machine', 'room', 'league']),
  result: z.enum(['win', 'draw', 'loss']),
  /** Place (Ludo : 1 = premier) ; null pour une nulle aux Dames. */
  place: z.number().int().positive().nullable(),
  playerCount: z.number().int().positive(),
  opponents: z.array(RecentOpponentSchema),
  /** Mise par joueur (0 : partie sans mise). */
  stake: z.number().int().nonnegative(),
  /** Cauris gagnés ou perdus sur cette partie (journal), null si aucun mouvement. */
  cauris: z.number().int().nullable(),
  /** Écart de force (partie classée), null sinon. */
  ratingDelta: z.number().int().nullable(),
  ranked: z.boolean(),
  endedAt: IsoDateSchema.nullable(),
});
export type RecentGame = z.infer<typeof RecentGameSchema>;

/** Onglet Dames, Ludo ou Raisonnement du profil. */
export const FamilyProfileSchema = z.object({
  family: GameFamilySchema,
  /** Variante principale (la plus jouée) ; null : pas encore classé (Raisonnement). */
  standing: VariantStandingSchema.nullable(),
  /** Toutes les variantes classées jouées (la principale en tête). */
  variants: z.array(VariantStandingSchema),
  record: GameRecordSchema,
  /** Trois dernières parties terminées. */
  recent: z.array(RecentGameSchema),
});
export type FamilyProfile = z.infer<typeof FamilyProfileSchema>;

export const ProfileQuarterSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
});
export type ProfileQuarter = z.infer<typeof ProfileQuarterSchema>;

/** GET /v1/me/profile, GET /v1/profiles/:userId */
export const ProfileSchema = z.object({
  userId: UuidSchema,
  pseudo: z.string(),
  /** Ton propre profil (solde, photo en vérification, liens vers le Studio et les Paramètres). */
  self: z.boolean(),
  /** Apparence telle que le lecteur la voit (toi : ta photo même en vérification). */
  look: PlayerLookSchema,
  /** Toi seulement : ta photo attend la modération (« en vérification »). */
  photoPending: z.boolean(),
  quarter: ProfileQuarterSchema.nullable(),
  /** Toi seulement : ton solde de cauris ; null pour un autre joueur. */
  cauris: z.number().int().nullable(),
  gamesPlayed: z.number().int().nonnegative(),
  cards: z.object({ owned: z.number().int().nonnegative(), total: z.number().int().positive() }),
  medals: z.object({
    gold: z.number().int().nonnegative(),
    silver: z.number().int().nonnegative(),
    bronze: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  /** Dames, Ludo, Raisonnement, dans cet ordre. */
  games: z.array(FamilyProfileSchema),
  memberSince: IsoDateSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileParamsSchema = z.object({ userId: UuidSchema });
