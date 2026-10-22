/**
 * Ludo : jeux de règles maison enregistrés et nommés (écran 20b, « les règles de Tata Odile »).
 *
 * Les réglages sont validés par @kwatt/rules-ludo (`validateSetup`, la même fonction que
 * l'appli utilise pour griser une option) puis normalisés (`normalizeHouseRules` : on ne garde
 * que ce qui diffère de la variante). Une partie jouée avec un jeu de règles maison est
 * amicale : pas de classement, pas de mise, pas de ligue publique (`isRanked`).
 *
 * Pour l'équipe Parties en ligne (création d'un salon) : `loadHouseRuleSet(db, ownerId, id)`.
 */
import {
  HOUSE_RULE_SETS_MAX,
  type CreateHouseRuleSetRequest,
  type HouseRuleSet,
  type HouseRulesDto,
  type LudoPreset,
  type UpdateHouseRuleSetRequest,
} from '@kwatt/protocol';
import { normalizeHouseRules, validateSetup, type HouseRules, type NewGameOptions } from '@kwatt/rules-ludo';
import { pgConstraint, pgErrorCode, PG_UNIQUE_VIOLATION, transaction, type Pool, type Sql } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

interface Row {
  id: string;
  name: string;
  preset: LudoPreset;
  rules: HouseRulesDto;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, name, preset, rules, created_at, updated_at';

function toDto(r: Row): HouseRuleSet {
  return { id: r.id, name: r.name, preset: r.preset, rules: r.rules, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() };
}

/** Réglages du protocole → type des règles (sans clés indéfinies). */
export function toHouseRules(dto: HouseRulesDto): HouseRules {
  const out: HouseRules = {};
  if (dto.exit !== undefined) out.exit = dto.exit;
  if (dto.capture !== undefined) out.capture = dto.capture;
  if (dto.protection !== undefined) out.protection = dto.protection;
  if (dto.barriers !== undefined) out.barriers = dto.barriers;
  return out;
}

/** Mise en place minimale d'une variante, pour vérifier des règles maison seules. */
export function setupFor(preset: LudoPreset, house: HouseRules | null): NewGameOptions {
  if (preset === 'pachisi') return { preset, players: 4, teams: [[0, 2], [1, 3]], house };
  return { preset, players: 2, house };
}

/**
 * Vérifie des règles maison pour une variante et les normalise. Combinaison bloquée →
 * AppError avec le code de @kwatt/rules-ludo (422) ; aucun réglage différent → `ludo.house_rules.empty`.
 */
export function checkHouseRules(preset: LudoPreset, dto: HouseRulesDto): HouseRules {
  const rules = toHouseRules(dto);
  const check = validateSetup(setupFor(preset, rules));
  if (!check.ok) throw new AppError(check.code, 422, check.params);
  const normalized = normalizeHouseRules(preset, rules);
  if (!normalized) throw new AppError('ludo.house_rules.empty', 422, { preset });
  return normalized;
}

function nameTaken(err: unknown): boolean {
  return pgErrorCode(err) === PG_UNIQUE_VIOLATION && pgConstraint(err) === 'house_rule_sets_owner_name';
}

export async function listHouseRuleSets(db: Sql, ownerId: string): Promise<HouseRuleSet[]> {
  const r = await db.query<Row>(`SELECT ${COLUMNS} FROM house_rule_sets WHERE owner_id = $1 ORDER BY updated_at DESC, id`, [ownerId]);
  return r.rows.map(toDto);
}

/** Jeu de règles d'un joueur, ou `ludo.house_rules.not_found` (404) : celui d'un autre n'existe pas pour lui. */
export async function loadHouseRuleSet(db: Sql, ownerId: string, id: string): Promise<HouseRuleSet> {
  const r = await db.query<Row>(`SELECT ${COLUMNS} FROM house_rule_sets WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  const row = r.rows[0];
  if (!row) throw new AppError('ludo.house_rules.not_found', 404);
  return toDto(row);
}

export async function createHouseRuleSet(pool: Pool, ownerId: string, req: CreateHouseRuleSetRequest): Promise<HouseRuleSet> {
  const rules = checkHouseRules(req.preset, req.rules);
  return transaction(pool, async (tx) => {
    // Verrou sur le joueur : deux créations simultanées ne dépassent pas la limite.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`house_rule_sets:${ownerId}`]);
    const count = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM house_rule_sets WHERE owner_id = $1', [ownerId]);
    if ((count.rows[0]?.n ?? 0) >= HOUSE_RULE_SETS_MAX) throw new AppError('ludo.house_rules.limit', 409, { max: HOUSE_RULE_SETS_MAX });
    try {
      const r = await tx.query<Row>(
        `INSERT INTO house_rule_sets (owner_id, name, preset, rules) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
        [ownerId, req.name.trim(), req.preset, JSON.stringify(rules)],
      );
      return toDto(r.rows[0]!);
    } catch (err) {
      if (nameTaken(err)) throw new AppError('ludo.house_rules.name_taken', 409);
      throw err;
    }
  });
}

export async function updateHouseRuleSet(db: Sql, ownerId: string, id: string, req: UpdateHouseRuleSetRequest): Promise<HouseRuleSet> {
  const current = await loadHouseRuleSet(db, ownerId, id);
  const preset = req.preset ?? current.preset;
  // Changer de variante sans redonner les règles : on revérifie les anciennes sur la nouvelle variante.
  const rules = checkHouseRules(preset, req.rules ?? current.rules);
  const name = req.name?.trim() ?? current.name;
  try {
    const r = await db.query<Row>(
      `UPDATE house_rule_sets SET name = $3, preset = $4, rules = $5, updated_at = now()
        WHERE id = $1 AND owner_id = $2 RETURNING ${COLUMNS}`,
      [id, ownerId, name, preset, JSON.stringify(rules)],
    );
    const row = r.rows[0];
    if (!row) throw new AppError('ludo.house_rules.not_found', 404);
    return toDto(row);
  } catch (err) {
    if (nameTaken(err)) throw new AppError('ludo.house_rules.name_taken', 409);
    throw err;
  }
}

export async function deleteHouseRuleSet(db: Sql, ownerId: string, id: string): Promise<void> {
  const r = await db.query('DELETE FROM house_rule_sets WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  if (r.rowCount === 0) throw new AppError('ludo.house_rules.not_found', 404);
}
