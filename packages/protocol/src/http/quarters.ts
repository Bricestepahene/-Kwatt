/**
 * Quartiers (écran 05 « Premier lancement », écran 36 « Guerre des quartiers », D-11).
 *
 * Routes (module serveur « accounts ») :
 *   GET /v1/quarters?q=&country=&limit=   (session : invité ou profil) → QuarterListResponse
 *   GET /v1/quarters/:id                  (session) → Quarter
 *   GET /v1/me/quarter                    (profil) → MyQuarterResponse
 *   PUT /v1/me/quarter                    (profil) SetQuarterRequest → MyQuarterResponse
 *
 * Un quartier = pays + ville + quartier ; `name` null désigne la ville entière (diaspora, ou
 * quartier absent de la liste). Les noms de lieux sont des données (jamais traduits), sauf le
 * nom anglais d'une ville quand il diffère (`cityEn` : « London » pour « Londres ») ; l'appli
 * traduit le pays à partir de son code ISO.
 *
 * Saison = mois civil, à l'heure du Cameroun (@kwatt/domain : seasonKey). Le premier choix est
 * libre ; ensuite, un changement par saison (erreur quarter.change_too_soon, params.nextChangeAt).
 */
import { z } from 'zod';
import { IsoDateSchema } from './common.js';

/** Identifiant stable : pays, ville et quartier en minuscules sans accents (« cm-douala-deido »). */
export const QUARTER_ID_PATTERN = /^[a-z]{2}(-[a-z0-9]+)+$/;
export const QuarterIdSchema = z.string().max(80).regex(QUARTER_ID_PATTERN);

/** Code pays ISO 3166-1 alpha-2 (« CM », « FR »). */
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

export const QuarterSchema = z.object({
  id: QuarterIdSchema,
  country: CountryCodeSchema,
  /** Nom courant de la ville (« Yaoundé », « Londres »). */
  city: z.string(),
  /** Nom anglais de la ville quand il diffère (« London ») ; sinon null. */
  cityEn: z.string().nullable(),
  /** Quartier (« Bonamoussadi ») ; null = toute la ville. */
  name: z.string().nullable(),
  /** Nombre de profils qui ont choisi ce quartier. */
  players: z.number().int().nonnegative(),
});
export type Quarter = z.infer<typeof QuarterSchema>;

export const QUARTER_SEARCH_MAX_LENGTH = 60;
export const QUARTER_SEARCH_DEFAULT_LIMIT = 20;
export const QUARTER_SEARCH_MAX_LIMIT = 50;

/** Recherche sans tenir compte des accents ni des capitales (« deido » trouve « Deïdo »). */
export const QuarterSearchQuerySchema = z.object({
  q: z.string().trim().max(QUARTER_SEARCH_MAX_LENGTH).optional(),
  country: CountryCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(QUARTER_SEARCH_MAX_LIMIT).default(QUARTER_SEARCH_DEFAULT_LIMIT),
});
export type QuarterSearchQuery = z.infer<typeof QuarterSearchQuerySchema>;

export const QuarterListResponseSchema = z.object({ items: z.array(QuarterSchema) });
export type QuarterListResponse = z.infer<typeof QuarterListResponseSchema>;

export const SetQuarterRequestSchema = z.object({ quarterId: QuarterIdSchema });
export type SetQuarterRequest = z.infer<typeof SetQuarterRequestSchema>;

export const MyQuarterResponseSchema = z.object({
  /** Quartier choisi ; null tant que le joueur n'a pas choisi. */
  quarter: QuarterSchema.nullable(),
  /** Date du choix du quartier actuel. */
  since: IsoDateSchema.nullable(),
  /** Prochain changement possible (début de la saison suivante) ; null = possible maintenant. */
  nextChangeAt: IsoDateSchema.nullable(),
  /** Saison en cours, « AAAA-MM ». */
  season: z.string().regex(/^\d{4}-\d{2}$/),
});
export type MyQuarterResponse = z.infer<typeof MyQuarterResponseSchema>;
