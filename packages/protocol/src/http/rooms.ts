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
