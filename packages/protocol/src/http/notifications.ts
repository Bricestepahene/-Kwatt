/**
 * Notifications (écran 08) : liste dans l'appli + push Expo + message WebSocket `notify`.
 *
 * Routes (préfixe /v1/notifications) :
 *   GET    /                ?cursor&limit → NotificationListResponse
 *   POST   /read            MarkReadRequest → { unreadCount }
 *   GET    /preferences     → NotificationPreferences
 *   PUT    /preferences     NotificationPreferences (partiel) → NotificationPreferences
 *   POST   /push-token      PushTokenRequest → OkResponse
 *   DELETE /push-token      PushTokenRequest → OkResponse
 *
 * Une notification porte un `kind` et des `params`, jamais de phrase : l'appli la traduit.
 * Seul le push est rendu par le serveur, dans la langue du destinataire
 * (`apps/server/src/i18n/{fr,en}.json`, clés `push.<kind>.title` et `push.<kind>.body`).
 *
 * Convention de nommage : `<catégorie>.<nom>`. La catégorie décide du réglage qui s'applique :
 *   turn.*     « C'est ton tour »                (ex. turn.your_turn)
 *   invites.*  « Invitations de salon »           (ex. invites.room, invites.challenge)
 *   league.*   « Matchs de ligue »                (ex. league.match_tomorrow, league.match_soon)
 *   autre      toujours envoyée                   (ex. quest.completed, account.password_changed)
 *
 * Les réglages coupent le PUSH de leur catégorie ; la notification reste dans la liste.
 * Pas de push quand le joueur a l'appli ouverte (connexion temps réel) : il reçoit `notify`.
 * Push Android : canal `turn`, `invites`, `league` ou `default` (canaux à créer par l'appli,
 * expo-notifications `setNotificationChannelAsync`) ; `data` = { notificationId, kind, params }.
 */
import { z } from 'zod';
import { IsoDateSchema, UuidSchema, paginated } from './common.js';

export const NOTIFICATION_CATEGORIES = ['turn', 'invites', 'league', 'general'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Catégorie d'un type de notification, d'après son préfixe. */
export function notificationCategory(kind: string): NotificationCategory {
  const prefix = kind.split('.', 1)[0];
  return prefix === 'turn' || prefix === 'invites' || prefix === 'league' ? prefix : 'general';
}

/**
 * Toutes les notifications envoyées par le serveur, avec leurs paramètres (l'appli traduit
 * chacune ; le serveur rend le push avec `push.<kind>` : tests de parité des deux côtés).
 */
export const NOTIFICATION_KINDS = [
  'invites.room', //                 { from, fromUserId, code, game, variant, roomName }
  'invites.challenge', //            { from, fromUserId, challengeId, game, variant, stake }
  'invites.challenge_countered', //  { from, fromUserId, challengeId, stake }
  'invites.challenge_accepted', //   { from, fromUserId, challengeId, gameId? }
  'invites.challenge_declined', //   { from, fromUserId, challengeId }
  'invites.friend_request', //       { from, userId }
  'friends.accepted', //             { from, userId }
  'league.match_tomorrow', //        { leagueId, leagueName, code, matchId, … }
  'league.match_soon', //            { leagueId, leagueName, code, matchId, minutes }
  'league.match_ready', //           { leagueId, leagueName, code, matchId, gameId }
  'league.started', //               { leagueId, leagueName, code }
  'league.cancelled', //             { leagueId, leagueName, code }
  'league.validate_due', //          { leagueId, leagueName, code, entrants }
  'league.forfeit', //               { leagueId, leagueName, code, matchId, absent, fine }
  'league.excluded', //              { leagueId, leagueName, code, refund }
  'league.player_excluded', //       { leagueId, leagueName, code, excluded, pseudo, before, after }
  'league.finished', //              { leagueId, leagueName, code, position }
  'league.removed', //               { leagueId, leagueName, code }
  'league.time_proposed', //         { leagueId, leagueName, code, matchId, time }
  'league.time_agreed', //           { leagueId, leagueName, code, matchId, time }
  'league.board_chosen', //          { leagueId, leagueName, code, matchId, board }
  'league.knockout_started', //      { leagueId, leagueName, code }
  'quest.completed', //              { questId, amount }
  'quest.completed_card', //         { questId, rarity }
  'rewards.streak', //               { days }
  'rewards.card', //                 { code }
  'quarters.champion', //            { quarterId, season }
  'profile.photo_approved', //       {}
  'profile.photo_rejected', //       {}
  'account.warning', //              { reason }
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NotificationKindSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/);

export const NotificationSchema = z.object({
  id: UuidSchema,
  kind: z.string(),
  params: z.record(z.string(), z.unknown()),
  createdAt: IsoDateSchema,
  readAt: IsoDateSchema.nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListResponseSchema = paginated(NotificationSchema).extend({
  unreadCount: z.number().int(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

/** Marquer comme lues : une liste d'identifiants, ou toutes. */
export const MarkReadRequestSchema = z
  .object({
    ids: z.array(UuidSchema).max(100).optional(),
    all: z.boolean().optional(),
  })
  .refine((r) => r.all === true || (r.ids !== undefined && r.ids.length > 0), { message: 'ids_or_all' });
export type MarkReadRequest = z.infer<typeof MarkReadRequestSchema>;
export const UnreadCountResponseSchema = z.object({ unreadCount: z.number().int() });
export type UnreadCountResponse = z.infer<typeof UnreadCountResponseSchema>;

/** Réglages de l'écran 13 (tous activés par défaut). */
export const NotificationPreferencesSchema = z.object({
  /** « C'est ton tour ». */
  turn: z.boolean(),
  /** « Invitations de salon ». */
  invites: z.boolean(),
  /** « Matchs de ligue (veille et 1 h avant) ». */
  league: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
export const NotificationPreferencesPatchSchema = NotificationPreferencesSchema.partial();
export type NotificationPreferencesPatch = z.infer<typeof NotificationPreferencesPatchSchema>;

/** Jeton Expo (`ExponentPushToken[…]` ou `ExpoPushToken[…]`), obtenu par expo-notifications. */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;
export const PushTokenRequestSchema = z.object({
  token: z.string().max(256),
});
export type PushTokenRequest = z.infer<typeof PushTokenRequestSchema>;
