/**
 * Authentification (SPEC §6) : inscription par e-mail, code de vérification, connexion,
 * jetons, invité, conversion invité → profil, mot de passe oublié, pseudo.
 *
 * Routes (préfixe /v1/auth) :
 *   POST register               RegisterRequest → 201 RegisterResponse
 *                               (avec le jeton d'accès d'un invité : conversion, même users.id)
 *   POST login                  LoginRequest → LoginResponse
 *   POST guest                  GuestRequest → 201 GuestResponse (nouvel invité) ou 200 (invité de l'appareil repris)
 *   POST refresh                RefreshRequest → AuthSessionResponse
 *   POST logout                 (jeton d'accès) → OkResponse
 *   POST logout-all             (jeton d'accès) → OkResponse
 *   POST email/verify           (jeton d'accès) VerifyEmailRequest → Me
 *   POST email/resend           (jeton d'accès) → ResendCodeResponse
 *   POST password/forgot        ForgotPasswordRequest → 202 OkResponse (même réponse si le compte n'existe pas)
 *   POST password/reset/verify  ResetVerifyRequest → ResetVerifyResponse
 *   POST password/reset         ResetPasswordRequest → AuthSessionResponse (toutes les autres sessions fermées)
 *   POST password/change        (jeton d'accès, profil) ChangePasswordRequest → OkResponse
 *   GET  pseudo/availability    ?pseudo= → PseudoAvailabilityResponse
 *
 * Jetons : accès JWT 15 min (`Authorization: Bearer …`) ; renouvellement opaque 30 jours,
 * tournant : chaque renouvellement rend un nouveau jeton et invalide l'ancien. Réutiliser un
 * ancien jeton ferme toutes les sessions de l'appareil. L'appli doit donc sérialiser ses
 * renouvellements (un seul à la fois).
 */
import { z } from 'zod';
import { DeviceSchema, IsoDateSchema, LocaleSchema } from './common.js';
import { MeSchema } from './me.js';

/** Pseudo : 3 à 20 caractères parmi lettres, chiffres, « _ » et « . ». Unique sans tenir compte de la casse. */
export const PSEUDO_MIN_LENGTH = 3;
export const PSEUDO_MAX_LENGTH = 20;
export const PSEUDO_PATTERN = /^[a-zA-Z0-9_.]{3,20}$/;
export function isValidPseudoFormat(pseudo: string): boolean {
  return PSEUDO_PATTERN.test(pseudo);
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Codes à 6 chiffres envoyés par e-mail : 10 minutes, 5 essais, renvoi après 60 s. */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 600;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const OtpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

/**
 * Les règles métier (longueur du mot de passe, format du pseudo, âge, consentement) sont
 * vérifiées par le serveur avec des codes précis (auth.password_too_short, auth.pseudo_invalid,
 * auth.too_young, auth.consent_required…) ; le schéma ne contrôle que la forme.
 */
export const RegisterRequestSchema = z.object({
  pseudo: z.string().trim().max(64),
  email: EmailSchema,
  password: z.string().max(PASSWORD_MAX_LENGTH),
  birthYear: z.number().int(),
  /** Règles du quartier et politique de confidentialité acceptées. */
  acceptTerms: z.boolean(),
  locale: LocaleSchema.optional(),
  device: DeviceSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  /** Pseudo OU adresse e-mail. */
  login: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  device: DeviceSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const GuestRequestSchema = z.object({
  device: DeviceSchema,
  locale: LocaleSchema.optional(),
});
export type GuestRequest = z.infer<typeof GuestRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(20).max(200),
  device: DeviceSchema,
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

/** Jetons + profil : réponse commune de l'inscription, de la connexion, de l'invité et du renouvellement. */
export const AuthSessionResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: IsoDateSchema,
  refreshToken: z.string(),
  refreshTokenExpiresAt: IsoDateSchema,
  me: MeSchema,
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;

/**
 * L'invité est lié à l'identifiant d'installation : si l'appareil a déjà un compte invité actif
 * (jetons perdus, renouvellement expiré), il est repris avec ses parties (`created: false`).
 */
export const GuestResponseSchema = AuthSessionResponseSchema.extend({
  created: z.boolean(),
});
export type GuestResponse = z.infer<typeof GuestResponseSchema>;

export const RegisterResponseSchema = AuthSessionResponseSchema.extend({
  /** true si un compte invité a été converti (ses parties sont gardées). */
  converted: z.boolean(),
  /** Bonus de bienvenue crédité par cette inscription (500, ou 0 s'il a déjà été versé). */
  welcomeBonus: z.number().int(),
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const LoginResponseSchema = AuthSessionResponseSchema.extend({
  /** true si une suppression du compte était demandée : la reconnexion l'annule. */
  deletionCancelled: z.boolean(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const VerifyEmailRequestSchema = z.object({ code: OtpCodeSchema });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ResendCodeResponseSchema = z.object({
  /** Prochain renvoi possible (60 s). */
  resendAvailableAt: IsoDateSchema,
  /** Expiration du code envoyé (10 min). */
  expiresAt: IsoDateSchema,
});
export type ResendCodeResponse = z.infer<typeof ResendCodeResponseSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: EmailSchema,
  locale: LocaleSchema.optional(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

/** Étape 2 de l'écran 06 : le code reçu contre un jeton de réinitialisation (15 min). */
export const ResetVerifyRequestSchema = z.object({ email: EmailSchema, code: OtpCodeSchema });
export type ResetVerifyRequest = z.infer<typeof ResetVerifyRequestSchema>;
export const ResetVerifyResponseSchema = z.object({ resetToken: z.string(), expiresAt: IsoDateSchema });
export type ResetVerifyResponse = z.infer<typeof ResetVerifyResponseSchema>;

/** Étape 3 : nouveau mot de passe ; toutes les sessions sont fermées puis cet appareil est connecté. */
export const ResetPasswordRequestSchema = z.object({
  resetToken: z.string().min(20).max(200),
  newPassword: z.string().max(PASSWORD_MAX_LENGTH),
  device: DeviceSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

/** Les autres appareils sont déconnectés ; la session courante est gardée. */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().max(PASSWORD_MAX_LENGTH),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const PseudoAvailabilityQuerySchema = z.object({ pseudo: z.string().trim().max(64) });
export type PseudoAvailabilityQuery = z.infer<typeof PseudoAvailabilityQuerySchema>;

export const PSEUDO_UNAVAILABLE_REASONS = ['taken', 'invalid', 'banned'] as const;
export const PseudoAvailabilityResponseSchema = z.object({
  pseudo: z.string(),
  available: z.boolean(),
  reason: z.enum(PSEUDO_UNAVAILABLE_REASONS).nullable(),
  /** 3 propositions libres quand le pseudo est pris ou interdit. */
  suggestions: z.array(z.string()),
});
export type PseudoAvailabilityResponse = z.infer<typeof PseudoAvailabilityResponseSchema>;
