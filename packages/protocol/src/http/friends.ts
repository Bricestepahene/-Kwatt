/**
 * Amis et présence (écran 12 « Mes amis », lien kwatt://ami/CODE ; contrat C6). Profils seulement.
 *
 * Routes (module serveur « friends ») :
 *   GET    /v1/friends                     → FriendsResponse (amis, en ligne d'abord, + demandes reçues)
 *   GET    /v1/friends/requests            → FriendRequestsResponse (reçues et envoyées)
 *   GET    /v1/friends/search?q=           → FriendSearchResponse (un compte jeune reste invisible des inconnus)
 *   GET    /v1/friends/code                → MyFriendCode (créé à la première demande)
 *   GET    /v1/friends/code/:code          → FriendCodeTarget (404 friends.not_found)
 *   POST   /v1/friends/requests            FriendRequestBody → FriendRequestResult
 *   POST   /v1/friends/requests/:userId/accept   → FriendRequestResult
 *   POST   /v1/friends/requests/:userId/decline  → OkResponse (refuser une reçue, ou annuler une envoyée)
 *   DELETE /v1/friends/:userId             → OkResponse (retirer un ami)
 *
 * Une demande vers quelqu'un qui t'a déjà demandé accepte directement. Notifications :
 * `invites.friend_request` { from, userId } et `friends.accepted` { from, userId }.
 * Présence en direct : message `presence.update` (ws/base.ts), envoyé aux amis seulement.
 */
import { z } from 'zod';
import { IsoDateSchema, UuidSchema } from './common.js';
import { PlayerLookSchema } from './profiles.js';

/** Au plus 200 amis, et 50 demandes envoyées en attente. */
export const MAX_FRIENDS = 200;
export const MAX_PENDING_REQUESTS = 50;

/** Code d'ami : 6 caractères sans 0/O/1/I (comme les codes de salon). */
export const FRIEND_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const FriendCodeSchema = z.string().regex(FRIEND_CODE_PATTERN);

/** Ce que fait un ami en ligne : il joue (partie, coup) ou il regarde une partie. */
export const FriendActivitySchema = z.object({
  kind: z.enum(['playing', 'watching']),
  gameId: z.string().optional(),
  family: z.enum(['dames', 'ludo']).optional(),
  /** Dames : demi-coups joués ; Ludo : tour en cours (« coup 14 »). */
  progress: z.number().int().nonnegative().optional(),
  /** La partie est publique : on peut la regarder. */
  watchable: z.boolean().optional(),
});
export type FriendActivity = z.infer<typeof FriendActivitySchema>;

export const FriendSchema = z.object({
  userId: UuidSchema,
  pseudo: z.string(),
  avatar: PlayerLookSchema.nullable(),
  online: z.boolean(),
  activity: FriendActivitySchema.optional(),
  /** Dernière présence (null en ligne, ou jamais vu). */
  lastSeenAt: IsoDateSchema.nullable(),
});
export type Friend = z.infer<typeof FriendSchema>;

export const FriendsResponseSchema = z.object({
  items: z.array(FriendSchema),
  /** Demandes reçues en attente (onglet « Demandes · 2 »). */
  incomingRequests: z.number().int().nonnegative(),
});
export type FriendsResponse = z.infer<typeof FriendsResponseSchema>;

/** Relation vue par le joueur : rien, ami, demande envoyée, demande reçue. */
export const FriendRelationSchema = z.enum(['none', 'friend', 'outgoing', 'incoming']);
export type FriendRelation = z.infer<typeof FriendRelationSchema>;

export const FriendRequestViewSchema = z.object({
  userId: UuidSchema,
  pseudo: z.string(),
  avatar: PlayerLookSchema.nullable(),
  direction: z.enum(['incoming', 'outgoing']),
  createdAt: IsoDateSchema,
  /** Quartier du joueur (nom, ou ville) : « Akwa ». */
  quarter: z.string().nullable(),
  /** Parties jouées ensemble : « vous avez joué 3 fois ». */
  gamesTogether: z.number().int().nonnegative(),
  /** Une ligue en commun : « Ligue Littoral ». */
  league: z.string().nullable(),
});
export type FriendRequestView = z.infer<typeof FriendRequestViewSchema>;

export const FriendRequestsResponseSchema = z.object({
  incoming: z.array(FriendRequestViewSchema),
  outgoing: z.array(FriendRequestViewSchema),
});
export type FriendRequestsResponse = z.infer<typeof FriendRequestsResponseSchema>;

export const FriendSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(20) });
export const FriendSearchItemSchema = z.object({
  userId: UuidSchema,
  pseudo: z.string(),
  avatar: PlayerLookSchema.nullable(),
  relation: FriendRelationSchema,
});
export type FriendSearchItem = z.infer<typeof FriendSearchItemSchema>;
export const FriendSearchResponseSchema = z.object({ items: z.array(FriendSearchItemSchema) });
export type FriendSearchResponse = z.infer<typeof FriendSearchResponseSchema>;

export const MyFriendCodeSchema = z.object({ code: FriendCodeSchema });
export type MyFriendCode = z.infer<typeof MyFriendCodeSchema>;

export const FriendCodeTargetSchema = FriendSearchItemSchema.extend({ self: z.boolean() });
export type FriendCodeTarget = z.infer<typeof FriendCodeTargetSchema>;

/** Demander en ami : par identifiant (recherche, salon) ou par code d'ami (lien). */
export const FriendRequestBodySchema = z
  .object({ userId: UuidSchema.optional(), code: FriendCodeSchema.optional() })
  .refine((b) => (b.userId === undefined) !== (b.code === undefined), { message: 'user_or_code' });
export type FriendRequestBody = z.infer<typeof FriendRequestBodySchema>;

export const FriendRequestResultSchema = z.object({
  userId: UuidSchema,
  relation: FriendRelationSchema,
});
export type FriendRequestResult = z.infer<typeof FriendRequestResultSchema>;
