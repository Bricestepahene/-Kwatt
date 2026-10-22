/**
 * Briques communes des routes REST (préfixe `/v1`, JSON).
 * Dates : chaînes ISO 8601 en UTC. Identifiants : UUID.
 */
import { z } from 'zod';

/** Langues de l'appli : chacun la sienne, dans la même partie (SPEC §4). */
export const LOCALES = ['fr', 'en'] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;
export const DEFAULT_LOCALE: Locale = 'fr';

export const UuidSchema = z.uuid();
export const IsoDateSchema = z.iso.datetime({ offset: true });

/** Plateformes d'installation (le web sert à la vérification par captures). */
export const PLATFORMS = ['android', 'ios', 'web'] as const;
export const PlatformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof PlatformSchema>;

/**
 * Appareil : l'appli génère un identifiant d'installation (UUID conseillé) au premier lancement,
 * le garde (SecureStore) et l'envoie à chaque connexion. Sert à interdire les mises entre
 * deux comptes vus sur le même appareil.
 */
export const DeviceSchema = z.object({
  installId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
  platform: PlatformSchema,
  appVersion: z.string().max(32).optional(),
});
export type Device = z.infer<typeof DeviceSchema>;

/** Pagination par curseur : `?cursor=…&limit=…` → `{ items, nextCursor }`. */
export const PaginationQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

/** GET /v1/health */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'down']),
  version: z.string(),
  uptimeSeconds: z.number(),
  time: IsoDateSchema,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
