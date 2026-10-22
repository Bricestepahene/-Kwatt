/**
 * Messages temps réel de base (fondation serveur) : accueil, ping/pong, présence, notification.
 */
import { z } from 'zod';
import { IsoDateSchema, UuidSchema } from '../http/common.js';
import { NotificationSchema } from '../http/notifications.js';
import { clientMessage, serverMessage } from './envelope.js';

/** Premier message du serveur après l'ouverture de la connexion. */
export const HelloMessageSchema = serverMessage('hello', {
  userId: UuidSchema,
  connectionId: z.string(),
  /** Heure du serveur (ms depuis 1970) : sert à corriger l'affichage des pendules. */
  serverTime: z.number(),
});
export type HelloMessage = z.infer<typeof HelloMessageSchema>;

/** Ping applicatif (mesure de latence). Le serveur répond `pong` avec `re` = `id`. */
export const PingMessageSchema = clientMessage('ping', {});
export type PingMessage = z.infer<typeof PingMessageSchema>;
export const PongMessageSchema = serverMessage('pong', { serverTime: z.number() });
export type PongMessage = z.infer<typeof PongMessageSchema>;

/** Présence des amis : envoyé quand un ami se connecte ou se déconnecte. */
export const PresenceEntrySchema = z.object({
  userId: UuidSchema,
  online: z.boolean(),
  lastSeenAt: IsoDateSchema.nullable(),
});
export type PresenceEntry = z.infer<typeof PresenceEntrySchema>;
export const PresenceUpdateMessageSchema = serverMessage('presence.update', {
  users: z.array(PresenceEntrySchema),
});
export type PresenceUpdateMessage = z.infer<typeof PresenceUpdateMessageSchema>;

/** Nouvelle notification (même forme que dans GET /v1/notifications). */
export const NotifyMessageSchema = serverMessage('notify', {
  notification: NotificationSchema,
  unreadCount: z.number().int(),
});
export type NotifyMessage = z.infer<typeof NotifyMessageSchema>;
