/**
 * Temps réel des salons (écran 25) : s'abonner à un salon pour recevoir sa vue à chaque
 * changement (arrivées, places, prêts, file, lancement de la partie).
 */
import { z } from 'zod';
import { RoomCodeSchema, RoomViewSchema } from '../http/rooms.js';
import { clientMessage, serverMessage } from './envelope.js';

export const RoomSubscribeMessageSchema = clientMessage('room.subscribe', { code: RoomCodeSchema });
export const RoomUnsubscribeMessageSchema = clientMessage('room.unsubscribe', { code: RoomCodeSchema });
/** Vue du salon, calculée pour le destinataire (champ `me`). */
export const RoomStateMessageSchema = serverMessage('room.state', { room: RoomViewSchema });
export type RoomStateMessage = z.infer<typeof RoomStateMessageSchema>;
