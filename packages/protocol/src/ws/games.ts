/**
 * Temps réel des parties en ligne (contrat C3). Le serveur fait foi : le client n'envoie que
 * des intentions, l'état vient toujours de `game.state` (numéro `seq` croissant).
 *
 * Client → serveur :
 *   game.subscribe   { gameId, spectate? }  s'abonner (joueur, ou spectateur sans profil)
 *   game.unsubscribe { gameId }
 *   game.sync        { gameId }             renvoie le dernier `game.state` (reconnexion)
 *   game.move        { gameId, seq, move }  Dames : notation officielle (« 32-28 », « 27x38 ») ;
 *                                           Ludo : pion vu du joueur au trait (« 2 », « 1.3 »)
 *   game.roll        { gameId, seq, clientSeed }  Ludo : lancer avec son grain de sel (hex)
 *   game.resign      { gameId }
 *   game.draw.offer  { gameId }             Dames, une fois tous les 10 coups au plus
 *   game.draw.answer { gameId, accept }
 *   game.react       { gameId, key }        joueurs : montrée tout de suite à l'adversaire ;
 *                                           spectateurs : montrées aux joueurs à la fin
 * Serveur → client :
 *   game.state  { gameId, seq, state, clocks, seats, … }
 *   game.event  { gameId, seq, event }       animations et sons (codes, jamais de texte)
 *   game.end    { gameId, outcome, reactions }
 */
import { z } from 'zod';
import { GameReactionSchema, GameSeatSchema } from '../http/games.js';
import { clientMessage, serverMessage } from './envelope.js';

const GameId = z.uuid();
const Seq = z.number().int().nonnegative();

export const GameSubscribeMessageSchema = clientMessage('game.subscribe', { gameId: GameId, spectate: z.boolean().optional() });
export const GameUnsubscribeMessageSchema = clientMessage('game.unsubscribe', { gameId: GameId });
export const GameSyncMessageSchema = clientMessage('game.sync', { gameId: GameId });
export const GameMoveMessageSchema = clientMessage('game.move', { gameId: GameId, seq: Seq, move: z.string().min(1).max(200) });
export const GameRollMessageSchema = clientMessage('game.roll', {
  gameId: GameId,
  seq: Seq,
  clientSeed: z.string().regex(/^[0-9a-f]{16,64}$/),
});
export const GameResignMessageSchema = clientMessage('game.resign', { gameId: GameId });
export const GameDrawOfferMessageSchema = clientMessage('game.draw.offer', { gameId: GameId });
export const GameDrawAnswerMessageSchema = clientMessage('game.draw.answer', { gameId: GameId, accept: z.boolean() });
export const GameReactMessageSchema = clientMessage('game.react', { gameId: GameId, key: z.string().min(1).max(40) });

export type GameMoveMessage = z.infer<typeof GameMoveMessageSchema>;
export type GameRollMessage = z.infer<typeof GameRollMessageSchema>;

/** Pendule d'un siège (Dames) ; `running` : c'est à lui. */
export const GameClockSchema = z.object({ remainingMs: z.number().int(), running: z.boolean() });
export type GameClock = z.infer<typeof GameClockSchema>;

/** Siège tel que le voit l'écran de partie : joueur, machine, connecté ou non, sorti. */
export const LiveSeatSchema = GameSeatSchema.extend({
  connected: z.boolean(),
  /** Ludo : le siège a quitté la partie (abandon ou absence de plus de 60 s). */
  out: z.boolean().optional(),
});
export type LiveSeat = z.infer<typeof LiveSeatSchema>;

export const GameOutcomeSchema = z.object({
  places: z.record(z.string(), z.number().int()),
  draw: z.boolean(),
  reason: z.string(),
});
export type GameOutcomeWire = z.infer<typeof GameOutcomeSchema>;

export const GameStateMessageSchema = serverMessage('game.state', {
  gameId: GameId,
  seq: Seq,
  family: z.enum(['dames', 'ludo']),
  variant: z.string(),
  status: z.enum(['waiting', 'playing', 'finished', 'aborted']),
  /** État des règles (@kwatt/rules-dames `DamesState` ou @kwatt/rules-ludo `LudoState`). */
  state: z.unknown(),
  /** Notation de la partie jusqu'ici (même format que C2). */
  moves: z.array(z.string()),
  /** Dames avec pendule ; null sinon. Clé = numéro de siège. */
  clocks: z.record(z.string(), GameClockSchema).nullable(),
  seats: z.array(LiveSeatSchema),
  /** Sièges joués par le destinataire (vide : spectateur). */
  mySeats: z.array(z.number().int()),
  /** Ludo : fin du temps de ce tour (ms depuis 1970, heure du serveur) ; null sinon. */
  turnDeadline: z.number().nullable(),
  /** Ludo : dernier lancer (siège, valeur ; cauris : détail des 6). */
  lastRoll: z.object({ seat: z.number().int(), value: z.number().int(), shells: z.array(z.boolean()).optional() }).nullable(),
  /** Dames : dernier coup joué (notation), pour le surligner. */
  lastMove: z.string().nullable(),
  /** Dames : proposition de nulle en attente (siège qui propose). */
  drawOffer: z.object({ seat: z.number().int() }).nullable(),
  /** La machine réfléchit (siège machine, ou tour joué à la place d'un absent). */
  thinking: z.boolean(),
  outcome: GameOutcomeSchema.nullable(),
  /** Empreinte du dé publiée au début (Ludo). */
  diceCommitment: z.string().nullable(),
  spectators: z.number().int().nonnegative(),
  /** Heure du serveur à l'envoi (ms) : corrige l'affichage des pendules. */
  serverTime: z.number(),
});
export type GameStateMessage = z.infer<typeof GameStateMessageSchema>;

export const GameEventSchema = z.object({
  kind: z.string(),
  seat: z.number().int().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type GameEventWire = z.infer<typeof GameEventSchema>;

export const GameEventMessageSchema = serverMessage('game.event', { gameId: GameId, seq: Seq, event: GameEventSchema });
export type GameEventMessage = z.infer<typeof GameEventMessageSchema>;

export const GameEndMessageSchema = serverMessage('game.end', {
  gameId: GameId,
  outcome: GameOutcomeSchema,
  /** Réactions des spectateurs, montrées aux joueurs à la fin seulement. */
  reactions: z.array(z.object({ key: GameReactionSchema, count: z.number().int() })),
});
export type GameEndMessage = z.infer<typeof GameEndMessageSchema>;

/** Accusé de réception d'une intention acceptée (l'état arrive par `game.state`). */
export const GameAckMessageSchema = serverMessage('game.ack', { gameId: GameId, seq: Seq });
export type GameAckMessage = z.infer<typeof GameAckMessageSchema>;
