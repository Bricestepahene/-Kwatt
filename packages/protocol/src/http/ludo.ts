/**
 * Ludo : jeux de règles maison enregistrés et nommés (écran 20b, planches LudoVariantes et
 * VariantesLudo, « les règles de Tata Odile »). Réutilisables à la création d'un salon.
 *
 *   GET    /v1/ludo/house-rules          → HouseRuleSetList
 *   POST   /v1/ludo/house-rules          { name, preset, rules } → 201 HouseRuleSet
 *   GET    /v1/ludo/house-rules/:id      → HouseRuleSet
 *   PUT    /v1/ludo/house-rules/:id      { name?, preset?, rules? } → HouseRuleSet
 *   DELETE /v1/ludo/house-rules/:id      → { ok: true }
 *
 * Profils seulement (un invité ne crée rien). Les réglages sont validés par @kwatt/rules-ludo
 * (`validateSetup`) : une combinaison bloquée est refusée avec son code `ludo.setup.*` (422).
 * Les valeurs ci-dessous reprennent les types de @kwatt/rules-ludo (vérifié par test côté serveur).
 */
import { z } from 'zod';
import { IsoDateSchema, UuidSchema } from './common.js';

/** Variantes (préréglages) du Ludo. */
export const LUDO_PRESETS = ['classique', 'rapide', 'six', 'parchis', 'pachisi'] as const;
export const LudoPresetSchema = z.enum(LUDO_PRESETS);
export type LudoPreset = z.infer<typeof LudoPresetSchema>;

export const LUDO_EXIT_RULES = ['six', 'six_or_one', 'five', 'grace'] as const;
export const LUDO_CAPTURE_RULES = ['home', 'home_roll_again', 'home_bonus20'] as const;
export const LUDO_PROTECTION_RULES = ['departs', 'etoiles_departs', 'sures', 'chateaux'] as const;
export const LUDO_BARRIER_RULES = ['none', 'any', 'six_opens', 'castles'] as const;

/** Les quatre réglages modifiables en règles maison. */
export const HouseRulesSchema = z.strictObject({
  exit: z.enum(LUDO_EXIT_RULES).optional(),
  capture: z.enum(LUDO_CAPTURE_RULES).optional(),
  protection: z.enum(LUDO_PROTECTION_RULES).optional(),
  barriers: z.enum(LUDO_BARRIER_RULES).optional(),
});
export type HouseRulesDto = z.infer<typeof HouseRulesSchema>;

export const HOUSE_RULE_SET_NAME_MAX = 40;
/** Nombre maximal de jeux de règles enregistrés par joueur. */
export const HOUSE_RULE_SETS_MAX = 20;

export const HouseRuleSetNameSchema = z.string().trim().min(1).max(HOUSE_RULE_SET_NAME_MAX);

export const HouseRuleSetSchema = z.object({
  id: UuidSchema,
  /** Nom saisi par le joueur (jamais traduit). */
  name: z.string(),
  preset: LudoPresetSchema,
  /** Réglages qui diffèrent de la variante (normalisés : jamais vide). */
  rules: HouseRulesSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type HouseRuleSet = z.infer<typeof HouseRuleSetSchema>;

export const HouseRuleSetListSchema = z.object({ items: z.array(HouseRuleSetSchema) });
export type HouseRuleSetList = z.infer<typeof HouseRuleSetListSchema>;

export const CreateHouseRuleSetRequestSchema = z.object({
  name: HouseRuleSetNameSchema,
  preset: LudoPresetSchema,
  rules: HouseRulesSchema,
});
export type CreateHouseRuleSetRequest = z.infer<typeof CreateHouseRuleSetRequestSchema>;

export const UpdateHouseRuleSetRequestSchema = z
  .object({
    name: HouseRuleSetNameSchema.optional(),
    preset: LudoPresetSchema.optional(),
    rules: HouseRulesSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.preset !== undefined || v.rules !== undefined, { message: 'empty' });
export type UpdateHouseRuleSetRequest = z.infer<typeof UpdateHouseRuleSetRequestSchema>;
