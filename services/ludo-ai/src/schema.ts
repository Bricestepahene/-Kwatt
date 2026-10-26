/**
 * Schémas des requêtes du service (zod). La position reçue est revérifiée :
 * sa configuration doit être exactement celle que les règles fabriquent pour
 * la même variante (on ne fait pas confiance à des mécanismes arbitraires).
 */
import { LEVELS, type Level } from '@kwatt/ludo-ai';
import { finish, LudoError, newGame, PRESET_IDS, type HouseRules, type LudoState } from '@kwatt/rules-ludo';
import { z } from 'zod';

const int = z.number().int();
const seatToken = z.object({ seat: int.min(0).max(5), token: int.min(0).max(3) });

export const MoveSchema = z.object({
  seat: int.min(0).max(5),
  token: int.min(0).max(3),
  from: int.min(-1).max(200),
  to: int.min(0).max(200),
  captures: z.array(seatToken).max(24),
});

const HouseSchema = z
  .object({
    exit: z.enum(['six', 'six_or_one', 'five', 'grace']).optional(),
    capture: z.enum(['home', 'home_roll_again', 'home_bonus20']).optional(),
    protection: z.enum(['departs', 'etoiles_departs', 'sures', 'chateaux']).optional(),
    barriers: z.enum(['none', 'any', 'six_opens', 'castles']).optional(),
  })
  .strict();

export const StateSchema = z.object({
  config: z.object({
    preset: z.enum(PRESET_IDS as [string, ...string[]]),
    board: z.string(),
    homes: int,
    mechanics: z.record(z.string(), z.unknown()),
    teams: z.array(z.array(int.min(0).max(5)).max(6)).max(3),
    house: HouseSchema.nullable(),
    timeLimitMs: z.number().nullable(),
  }),
  seats: z.array(z.object({ home: int.min(0).max(5), status: z.enum(['playing', 'finished', 'out']) })).min(2).max(6),
  tokens: z.array(z.array(int.min(-1).max(200)).min(1).max(4)).min(2).max(6),
  current: int.min(0).max(5),
  phase: z.enum(['roll', 'move', 'over']),
  roll: z.number().int().nullable(),
  sixesInRow: int.min(0).max(3),
  turnNo: int.min(1),
  ranking: z.array(int.min(0).max(5)).max(6),
  bonus: z.array(int.min(1).max(20)).max(8),
  extraRoll: z.boolean(),
  lastMoved: seatToken.nullable(),
  freeExit: z.array(z.boolean()).max(6),
});

export const ChooseRequestSchema = z.object({
  state: StateSchema,
  legal: z.array(MoveSchema).max(24).optional(),
  level: z.enum(LEVELS as unknown as [Level, ...Level[]]),
  seed: int.min(0).max(0xffffffff).optional(),
  budgetMs: int.min(0).max(60_000).optional(),
});

export type ChooseRequest = z.infer<typeof ChooseRequestSchema>;

export class InvalidStateError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string | number | boolean | null> = {},
  ) {
    super(code);
  }
}

/** Égalité de valeurs JSON, sans tenir compte de l'ordre des clés. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Position revérifiée : configuration et sièges reconstruits par les règles. */
export function checkedState(raw: ChooseRequest['state']): LudoState {
  const teams = raw.config.teams;
  // Réglages maison sans les clés vides.
  const house = raw.config.house ? (Object.fromEntries(Object.entries(raw.config.house).filter(([, v]) => v !== undefined)) as HouseRules) : null;
  let fresh: LudoState;
  try {
    fresh = newGame({
      preset: raw.config.preset as LudoState['config']['preset'],
      players: raw.seats.length,
      ...(teams.length > 0 ? { teams } : {}),
      house,
    });
  } catch (e) {
    if (e instanceof LudoError) throw new InvalidStateError(e.code);
    throw e;
  }
  if (!deepEqual(fresh.config, raw.config)) throw new InvalidStateError('ludo_ai.invalid_state', { field: 'config' });
  if (raw.seats.some((s, i) => s.home !== fresh.seats[i]!.home)) throw new InvalidStateError('ludo_ai.invalid_state', { field: 'seats' });
  const n = fresh.config.mechanics.tokensPerPlayer;
  const end = finish(fresh.config);
  if (raw.tokens.length !== raw.seats.length || raw.tokens.some((t) => t.length !== n || t.some((p) => p > end))) {
    throw new InvalidStateError('ludo_ai.invalid_state', { field: 'tokens' });
  }
  if (raw.current >= raw.seats.length || raw.freeExit.length !== raw.seats.length) throw new InvalidStateError('ludo_ai.invalid_state', { field: 'current' });
  return { ...raw, config: fresh.config } as LudoState;
}
