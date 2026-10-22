/**
 * Profil minimal du joueur connecté : `/v1/me` (SPEC §6).
 * Le module Profil (avatar, cadre, photo, quartier…) ajoute ses champs dans son propre fichier.
 */
import { z } from 'zod';
import { IsoDateSchema, LocaleSchema, UuidSchema } from './common.js';

export const USER_KINDS = ['guest', 'member'] as const;
export const UserKindSchema = z.enum(USER_KINDS);
export type UserKind = z.infer<typeof UserKindSchema>;

/** Tranches d'âge d'un profil (l'année de naissance n'est jamais renvoyée ni affichée). */
export const AGE_GROUPS = ['teen', 'adult'] as const;
export const AgeGroupSchema = z.enum(AGE_GROUPS);
export type AgeGroup = z.infer<typeof AgeGroupSchema>;

/** Âges seuils (écran 04) : moins de 13 ans pas de profil ; 13–17 compte jeune ; 18+ compte complet. */
export const MIN_PROFILE_AGE = 13;
export const ADULT_AGE = 18;
/** Pseudo modifiable une fois tous les 30 jours. */
export const PSEUDO_CHANGE_INTERVAL_DAYS = 30;
/** Effacement définitif 30 jours après la demande, annulable en se reconnectant. */
export const DELETION_GRACE_DAYS = 30;

/**
 * Réglages synchronisés du joueur (sons, vibration, numéros des cases, animation du dé…).
 * Clés libres choisies par l'appli, valeurs simples ; 50 clés au plus.
 */
export const SETTINGS_MAX_KEYS = 50;
export const SettingValueSchema = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);
export const SettingsSchema = z
  .record(z.string().min(1).max(64), SettingValueSchema)
  .refine((s) => Object.keys(s).length <= SETTINGS_MAX_KEYS, { message: 'too_many_keys' });
export type Settings = z.infer<typeof SettingsSchema>;

/** Ce que le compte a le droit de faire, calculé par le serveur (l'appli s'en sert pour afficher ou griser). */
export const PermissionsSchema = z.object({
  /** Mises entre joueurs : profil de 18 ans et plus, e-mail vérifié. */
  canStake: z.boolean(),
  /** Pronostics des spectateurs : mêmes conditions que les mises. */
  canPredict: z.boolean(),
  /** Ligues payantes : mêmes conditions que les mises. */
  canJoinPaidLeagues: z.boolean(),
  /** Créer un salon, une ligue : profils seulement (pas les invités). */
  canCreate: z.boolean(),
  /** Trouvable par pseudo et invitable par des inconnus : profils de 18 ans et plus. */
  visibleToStrangers: z.boolean(),
});
export type Permissions = z.infer<typeof PermissionsSchema>;

/** GET /v1/me */
export const MeSchema = z.object({
  id: UuidSchema,
  kind: UserKindSchema,
  /** null pour un invité. */
  pseudo: z.string().nullable(),
  /** Adresse du profil (visible seulement par son titulaire). */
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  locale: LocaleSchema,
  /** null pour un invité. */
  ageGroup: AgeGroupSchema.nullable(),
  permissions: PermissionsSchema,
  /** Date à partir de laquelle le pseudo peut de nouveau changer ; null = possible maintenant. */
  pseudoChangeAvailableAt: IsoDateSchema.nullable(),
  /** Suppression demandée : date de la demande et date de l'effacement définitif. */
  deletionRequestedAt: IsoDateSchema.nullable(),
  deletionScheduledFor: IsoDateSchema.nullable(),
  settings: SettingsSchema,
  createdAt: IsoDateSchema,
});
export type Me = z.infer<typeof MeSchema>;

/** PATCH /v1/me/pseudo → Me */
export const ChangePseudoRequestSchema = z.object({ pseudo: z.string().trim().max(64) });
export type ChangePseudoRequest = z.infer<typeof ChangePseudoRequestSchema>;

/** PATCH /v1/me/locale → Me (invités compris) */
export const ChangeLocaleRequestSchema = z.object({ locale: LocaleSchema });
export type ChangeLocaleRequest = z.infer<typeof ChangeLocaleRequestSchema>;

/** PATCH /v1/me/settings → { settings } : fusion clé par clé, une valeur null retire la clé. */
export const SettingsPatchRequestSchema = z.object({ settings: SettingsSchema });
export type SettingsPatchRequest = z.infer<typeof SettingsPatchRequestSchema>;
export const SettingsResponseSchema = z.object({ settings: SettingsSchema });
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

/**
 * POST /v1/me/delete : déconnexion de tous les appareils, profil masqué,
 * effacement définitif à J+30, annulable en se reconnectant avant.
 * Le mot de passe est exigé pour un profil (pas pour un invité).
 */
export const DeleteAccountRequestSchema = z.object({ password: z.string().max(128).optional() });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;
export const DeleteAccountResponseSchema = z.object({ deletionScheduledFor: IsoDateSchema });
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponseSchema>;

/**
 * GET /v1/me/export : toutes les données du joueur, en JSON (profil, appareils, parties,
 * journal des cauris, notifications…). Chaque module serveur ajoute sa section.
 */
export const ExportResponseSchema = z.object({
  format: z.literal('kwatt-export'),
  version: z.literal(1),
  exportedAt: IsoDateSchema,
  userId: UuidSchema,
  sections: z.record(z.string(), z.unknown()),
});
export type ExportResponse = z.infer<typeof ExportResponseSchema>;

/**
 * Nom d'affichage d'un joueur dont le compte a été effacé (parties passées des autres joueurs).
 * L'appli le remplace par sa traduction (« Joueur parti » / « Former player »).
 */
export const ERASED_DISPLAY_NAME = '';
