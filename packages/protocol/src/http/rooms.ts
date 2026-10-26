/**
 * Salons : contrat partagé entre l'équipe Comptes (écran 02 « Rejoindre avec un code », qui
 * l'utilise) et l'équipe Parties en ligne (qui implémente la route et complète ce fichier).
 *
 *   GET /v1/rooms/by-code/:code  → RoomPreview
 *     erreurs : room.not_found (404), room.closed (410) ; sans jeton ou avec un jeton
 *     d'invité ou de profil (l'écran 02 l'appelle avant de créer la session invitée).
 *
 * Code de 6 caractères sans 0/O/1/I, affiché « ABC-DEF » (SPEC §10).
 */
import { z } from 'zod';
import { UuidSchema } from './common.js';

export const ROOM_CODE_LENGTH = 6;
/** Alphabet des codes : sans 0, O, 1, I (lisibles à voix haute). */
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const RoomCodeSchema = z.string().regex(ROOM_CODE_PATTERN);

export const ROOM_GAMES = ['dames', 'ludo'] as const;
export const RoomGameSchema = z.enum(ROOM_GAMES);
export type RoomGame = z.infer<typeof RoomGameSchema>;

/** Partie simple · aller-retour · roi de la table (SPEC §10). */
export const ROOM_FORMATS = ['simple', 'aller_retour', 'roi'] as const;
export const RoomFormatSchema = z.enum(ROOM_FORMATS);
export type RoomFormat = z.infer<typeof RoomFormatSchema>;

/** open : on peut s'asseoir · playing : partie lancée (on peut regarder) · closed : fermé. */
export const ROOM_STATUSES = ['open', 'playing', 'closed'] as const;
export const RoomStatusSchema = z.enum(ROOM_STATUSES);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

export const RoomPreviewPlayerSchema = z.object({
  userId: UuidSchema,
  /** Pseudo du profil, ou nom de partie d'un invité. */
  pseudo: z.string(),
  /** Avatar du joueur (forme définie par l'équipe Profil) ; null = initiale. */
  avatar: z.unknown().nullable(),
});
export type RoomPreviewPlayer = z.infer<typeof RoomPreviewPlayerSchema>;

/** Aperçu d'un salon trouvé par son code (écran 02 : « Salon trouvé »). */
export const RoomPreviewSchema = z.object({
  code: RoomCodeSchema,
  game: RoomGameSchema,
  /** Variante (game_variant : dames10, dames8, ludo_classique…). */
  variant: z.string(),
  /** Nom du salon, saisi par l'hôte (jamais traduit). */
  name: z.string(),
  host: z.object({ userId: UuidSchema, pseudo: z.string() }),
  /** Nombre de places à table (2 à 6). */
  seats: z.number().int().min(2).max(6),
  /** Joueurs assis. */
  seated: z.array(RoomPreviewPlayerSchema),
  /** Joueurs dans la file d'attente. */
  queueLength: z.number().int().nonnegative(),
  format: RoomFormatSchema,
  /** Mise par joueur en cauris (0 = amical). */
  stake: z.number().int().nonnegative(),
  status: RoomStatusSchema,
});
export type RoomPreview = z.infer<typeof RoomPreviewSchema>;

/* ------------------------------------------------------------------ */
/* Salons : création, vue complète, actions (écrans 24 et 25)          */
/*                                                                    */
/*   POST /v1/rooms                   CreateRoomRequest → RoomView     */
/*   GET  /v1/rooms/open?game=        → { items: RoomPreview[] }       */
/*   GET  /v1/rooms/:code             → RoomView                       */
/*   POST /v1/rooms/:code/join        JoinRoomRequest → RoomView       */
/*   POST /v1/rooms/:code/leave       → RoomView                       */
/*   POST /v1/rooms/:code/ready       { ready } → RoomView             */
/*   POST /v1/rooms/:code/start       (hôte) → RoomView (gameId)       */
/*   POST /v1/rooms/:code/invite      { userId } → { ok: true }        */
/*   WS   room.subscribe { code } / room.unsubscribe → room.state      */
/* ------------------------------------------------------------------ */

/** Pendules des salons (SPEC §10) : 5 min + 3 s par défaut. */
export const ROOM_CLOCKS = [
  { initialMs: 3 * 60_000, incrementMs: 2_000 },
  { initialMs: 5 * 60_000, incrementMs: 3_000 },
  { initialMs: 10 * 60_000, incrementMs: 5_000 },
  { initialMs: 15 * 60_000, incrementMs: 10_000 },
] as const;
export const DEFAULT_ROOM_CLOCK = ROOM_CLOCKS[1];
/** Temps par tour au Ludo (SPEC §10 : 30 s par défaut). */
export const ROOM_TURN_MS = [15_000, 30_000] as const;
export const DEFAULT_ROOM_TURN_MS = 30_000;

export const RoomClockSchema = z.object({ initialMs: z.number().int().positive(), incrementMs: z.number().int().nonnegative() });
export type RoomClock = z.infer<typeof RoomClockSchema>;

export const RoomNameSchema = z.string().trim().min(1).max(30);

export const CreateRoomRequestSchema = z.object({
  game: RoomGameSchema,
  variant: z.string().min(1).max(32),
  name: RoomNameSchema,
  seats: z.number().int().min(2).max(6),
  format: RoomFormatSchema,
  /** Dames : pendule (une des ROOM_CLOCKS) ; défaut 5 min + 3 s. */
  clock: RoomClockSchema.optional(),
  /** Ludo : temps par tour (ROOM_TURN_MS). */
  turnMs: z.number().int().optional(),
  stake: z.number().int().nonnegative(),
  /** Ludo : règles maison (partie amicale). */
  house: z.record(z.string(), z.string()).nullable().optional(),
  /** Ludo : jouer en équipes (Pachisi : toujours). */
  teams: z.boolean().optional(),
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export const RoomPlayerSchema = z.object({
  userId: UuidSchema,
  pseudo: z.string(),
  avatar: z.unknown().nullable(),
  guest: z.boolean(),
  /** Mise bloquée au lancement (profil de 18 ans et plus, salon avec mise). */
  staking: z.boolean(),
  connected: z.boolean(),
});
export type RoomPlayer = z.infer<typeof RoomPlayerSchema>;

export const RoomSeatViewSchema = z.object({
  seat: z.number().int().nonnegative(),
  player: RoomPlayerSchema.nullable(),
  ready: z.boolean(),
  /** Place gardée 60 s après un départ ou une coupure (ISO) ; null sinon. */
  keptUntil: z.string().nullable(),
});
export type RoomSeatView = z.infer<typeof RoomSeatViewSchema>;

export const RoomViewSchema = z.object({
  code: RoomCodeSchema,
  game: RoomGameSchema,
  variant: z.string(),
  name: z.string(),
  host: z.object({ userId: UuidSchema, pseudo: z.string() }),
  seats: z.number().int().min(2).max(6),
  format: RoomFormatSchema,
  stake: z.number().int().nonnegative(),
  status: RoomStatusSchema,
  /** Règles maison, Parchís, Pachisi : partie amicale (ni force, ni mise). */
  friendly: z.boolean(),
  house: z.record(z.string(), z.string()).nullable(),
  teams: z.boolean(),
  clock: RoomClockSchema.nullable(),
  turnMs: z.number().int().nullable(),
  table: z.array(RoomSeatViewSchema),
  queue: z.array(RoomPlayerSchema.extend({ position: z.number().int().positive() })),
  spectators: z.number().int().nonnegative(),
  me: z.object({
    role: z.enum(['seat', 'queue', 'spectator']).nullable(),
    seat: z.number().int().nullable(),
    ready: z.boolean(),
    isHost: z.boolean(),
    /** Peut miser dans ce salon (profil de 18 ans et plus, e-mail vérifié). */
    canStake: z.boolean(),
  }),
  /** Partie en cours (ou la dernière) ; leg : manche de l'aller-retour. */
  gameId: z.string().nullable(),
  lastGameId: z.string().nullable(),
  leg: z.union([z.literal(1), z.literal(2)]).nullable(),
  /** Roi de la table : le joueur qui garde sa place et ses victoires d'affilée. */
  king: z.object({ userId: UuidSchema, pseudo: z.string(), wins: z.number().int() }).nullable(),
  /** Fermeture automatique (30 min sans partie). */
  closesAt: z.string().nullable(),
  createdAt: z.string(),
});
export type RoomView = z.infer<typeof RoomViewSchema>;

export const JoinRoomRequestSchema = z.object({
  as: z.enum(['seat', 'queue', 'spectator']).default('seat'),
  seat: z.number().int().min(0).max(5).optional(),
});
export type JoinRoomRequest = z.infer<typeof JoinRoomRequestSchema>;

export const RoomReadyRequestSchema = z.object({ ready: z.boolean() });
export const RoomInviteRequestSchema = z.object({ userId: UuidSchema });
export const OpenRoomsQuerySchema = z.object({ game: RoomGameSchema.optional() });
export const OpenRoomsResponseSchema = z.object({ items: z.array(RoomPreviewSchema) });
export type OpenRoomsResponse = z.infer<typeof OpenRoomsResponseSchema>;
