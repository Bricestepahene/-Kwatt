/**
 * Catalogue d'objets et boutique (écrans 10 Studio d'avatar, 11 Boutique d'avatars, 39 Cartes).
 * Pas d'argent réel : tout s'achète en cauris gagnés au jeu, par le grand livre.
 *
 * Routes :
 *   GET  /v1/shop/items   ?kinds=avatar_preset,frame → ShopCatalogResponse (profil)
 *   POST /v1/shop/buy     BuyRequest → BuyResponse (profil ; idempotent : racheter un objet
 *                         déjà acheté rend l'achat existant, sans nouveau débit)
 *
 * Le serveur n'envoie jamais de nom d'objet : l'appli traduit le code (`items:<code>`).
 */
import { z } from 'zod';
import { IsoDateSchema } from './common.js';

/** Familles d'objets du catalogue. L'équipe Progression ajoute les cartes (`card`) et les habillages. */
export const ITEM_KINDS = [
  'avatar_skin',
  'avatar_hat',
  'avatar_outfit',
  'avatar_preset',
  'frame',
  'card',
  'board_skin',
  'piece_skin',
  'dice_skin',
] as const;
export const ItemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKindSchema>;

/** Raretés (écrans 11 et 39) : plus un objet est rare, plus il coûte cher. */
export const ITEM_RARITIES = ['commune', 'rare', 'epique', 'legendaire'] as const;
export const ItemRaritySchema = z.enum(ITEM_RARITIES);
export type ItemRarity = z.infer<typeof ItemRaritySchema>;

/** D'où vient un objet possédé : achat, récompense (quête, trophée, série…), objet de base. */
export const ITEM_SOURCES = ['purchase', 'reward', 'default'] as const;
export const ItemSourceSchema = z.enum(ITEM_SOURCES);
export type ItemSource = z.infer<typeof ItemSourceSchema>;

/** Échelons (SPEC §7), dans l'ordre : un objet peut demander un échelon minimal. */
export const PROFILE_RANKS = ['apprenti', 'debrouillard', 'ancien', 'notable', 'chef', 'fon'] as const;
export const ProfileRankSchema = z.enum(PROFILE_RANKS);
export type ProfileRank = z.infer<typeof ProfileRankSchema>;

/** Code d'objet : minuscules, chiffres et « _ » (il sert aussi de clé de traduction). */
export const ITEM_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
export const ItemCodeSchema = z.string().regex(ITEM_CODE_PATTERN);

// --- Données de rendu ------------------------------------------------------------------
// Chaque objet porte ses données de rendu (`render`, jsonb). Pour les avatars et les cadres,
// leur forme est fixée ici ; les cartes et habillages définissent la leur.

/** Les quatre tissus dessinés en code (planche « Réf · Identité »). */
export const FABRIC_NAMES = ['ndop', 'toghu', 'kaba', 'obom'] as const;
export const FabricNameSchema = z.enum(FABRIC_NAMES);
export type Fabric = z.infer<typeof FabricNameSchema>;

/** Formes de coiffe : bonnet (dôme), foulard noué, toque haute, couronne. */
export const HAT_SHAPES = ['bonnet', 'foulard', 'toque', 'couronne'] as const;
export const HatShapeSchema = z.enum(HAT_SHAPES);
export type HatShape = z.infer<typeof HatShapeSchema>;

/** Teint : indice dans `avatarSkins` de @kwatt/design (0 = le plus clair). */
export const SkinToneSchema = z.number().int().min(0).max(4);

export const HatRenderSchema = z.object({ fabric: FabricNameSchema, shape: HatShapeSchema });
export type HatRender = z.infer<typeof HatRenderSchema>;

/** `render` d'un teint. */
export const SkinItemRenderSchema = z.object({ tone: SkinToneSchema });
/** `render` d'une coiffe. */
export const HatItemRenderSchema = HatRenderSchema;
/** `render` d'une tenue. */
export const OutfitItemRenderSchema = z.object({ fabric: FabricNameSchema });
/** `render` d'un avatar prêt : une composition fixe, sur un fond de tissu. */
export const PresetItemRenderSchema = z.object({
  skin: SkinToneSchema,
  hat: HatRenderSchema.nullable(),
  outfit: FabricNameSchema,
  background: FabricNameSchema,
  /** Événement d'une édition limitée (« ngondo_2026 »), traduit par l'appli. */
  event: z.string().regex(ITEM_CODE_PATTERN).optional(),
});
/** `render` d'un cadre de tissu. */
export const FrameItemRenderSchema = z.object({ fabric: FabricNameSchema });

// --- Catalogue ---------------------------------------------------------------------------

export const ItemEditionSchema = z.object({
  /** Nombre d'exemplaires de l'édition limitée. */
  total: z.number().int().positive(),
  /** Exemplaires déjà partis (« 312 / 500 exemplaires partis »). */
  sold: z.number().int().nonnegative(),
});
export type ItemEdition = z.infer<typeof ItemEditionSchema>;

/** Objet du catalogue, vu par le joueur connecté. */
export const ShopItemSchema = z.object({
  code: ItemCodeSchema,
  kind: ItemKindSchema,
  rarity: ItemRaritySchema,
  /** Prix en cauris ; null : ne s'achète pas (objet de base, récompense, déblocage d'échelon). */
  price: z.number().int().positive().nullable(),
  edition: ItemEditionSchema.nullable(),
  /** Échelon minimal (le meilleur échelon du joueur, tous jeux confondus). */
  minRank: ProfileRankSchema.nullable(),
  /** Objet de base, offert à tous les profils. */
  isDefault: z.boolean(),
  render: z.record(z.string(), z.unknown()),
  /** À toi (acheté, gagné, de base ou débloqué par ton échelon). */
  owned: z.boolean(),
  /** Ton numéro d'exemplaire (édition limitée). */
  serial: z.number().int().positive().nullable(),
  /** Échelon trop bas pour l'acheter ou s'en servir. */
  locked: z.boolean(),
  /** Achetable maintenant (en vente, pas à toi, pas épuisé, échelon suffisant ; le solde n'est pas compté). */
  buyable: z.boolean(),
  sortOrder: z.number().int(),
});
export type ShopItem = z.infer<typeof ShopItemSchema>;

/** GET /v1/shop/items?kinds=… */
export const ShopCatalogQuerySchema = z.object({
  /** Familles voulues, séparées par des virgules (toutes par défaut). */
  kinds: z
    .string()
    .max(200)
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return undefined;
      const list = v.split(',').map((s) => s.trim()).filter(Boolean);
      for (const k of list) {
        if (!(ITEM_KINDS as readonly string[]).includes(k)) {
          ctx.addIssue({ code: 'custom', message: 'unknown_kind' });
          return z.NEVER;
        }
      }
      return list as ItemKind[];
    }),
});
export type ShopCatalogQuery = z.infer<typeof ShopCatalogQuerySchema>;

export const ShopCatalogResponseSchema = z.object({
  items: z.array(ShopItemSchema),
  /** Solde du joueur, pour griser ce qu'il ne peut pas s'offrir. */
  balance: z.number().int(),
  /** Meilleur échelon du joueur, tous jeux confondus (déblocages). */
  rank: ProfileRankSchema,
});
export type ShopCatalogResponse = z.infer<typeof ShopCatalogResponseSchema>;

/** Nombre maximal d'objets achetés d'un coup (pièces d'avatar du Studio). */
export const MAX_ITEMS_PER_PURCHASE = 5;

/**
 * POST /v1/shop/buy : un objet (`itemCode`) ou plusieurs d'un coup (`itemCodes`, pièces
 * d'avatar du Studio : tout ou rien, dans une seule transaction).
 */
export const BuyRequestSchema = z.union([
  z.object({ itemCode: ItemCodeSchema }).strict(),
  z.object({ itemCodes: z.array(ItemCodeSchema).min(1).max(MAX_ITEMS_PER_PURCHASE) }).strict(),
]);
export type BuyRequest = z.infer<typeof BuyRequestSchema>;

export const PurchaseSchema = z.object({
  code: ItemCodeSchema,
  price: z.number().int().positive(),
  /** Numéro d'exemplaire attribué (édition limitée). */
  serial: z.number().int().positive().nullable(),
  /** Mouvement du grand livre. */
  txId: z.uuid(),
  /** Achat déjà fait auparavant (requête rejouée) : rien n'a été débité cette fois. */
  replayed: z.boolean(),
  acquiredAt: IsoDateSchema,
});
export type Purchase = z.infer<typeof PurchaseSchema>;

export const BuyResponseSchema = z.object({
  purchases: z.array(PurchaseSchema),
  balance: z.number().int(),
  /** Les objets achetés, à jour (owned, serial). */
  items: z.array(ShopItemSchema),
});
export type BuyResponse = z.infer<typeof BuyResponseSchema>;

/**
 * Détails d'un achat au journal des cauris (`meta` du mouvement `purchase`) :
 * l'appli affiche le nom de l'objet et son numéro d'exemplaire.
 */
export const PurchaseMetaSchema = z.object({
  itemCode: ItemCodeSchema,
  itemKind: ItemKindSchema,
  serial: z.number().int().positive().nullable(),
});
export type PurchaseMeta = z.infer<typeof PurchaseMetaSchema>;

/** Taille de la collection de cartes (planche Cartes : « 14 / 48 gagnées »). */
export const CARD_COLLECTION_SIZE = 48;
