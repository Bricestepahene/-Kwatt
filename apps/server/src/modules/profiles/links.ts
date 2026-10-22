/**
 * Données que le profil lit chez d'autres équipes, qui les écrivent en parallèle :
 * - quartier (équipe Comptes : table `quarters`, colonne `profiles.quarter_id`) ;
 * - médailles (équipes Ligues et Communauté : table `medals`, kind or | argent | bronze).
 *
 * Tant que ces tables n'existent pas dans la base, le profil s'en passe (quartier libre de
 * `profiles.quarter`, aucune médaille). Point de raccord unique pour l'intégration.
 */
import type { ProfileQuarter } from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';

async function tableExists(db: Sql, table: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${table}`]);
  return r.rows[0]?.ok === true;
}

async function columnExists(db: Sql, table: string, column: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return r.rows.length > 0;
}

function pick(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

/** Quartier du joueur (« Bonamoussadi », Douala, Cameroun), ou null. */
export async function quarterOf(db: Sql, userId: string): Promise<ProfileQuarter | null> {
  if ((await tableExists(db, 'quarters')) && (await columnExists(db, 'profiles', 'quarter_id'))) {
    const r = await db.query<{ q: Record<string, unknown> | null }>(
      'SELECT to_jsonb(q) AS q FROM profiles p JOIN quarters q ON q.id = p.quarter_id WHERE p.user_id = $1',
      [userId],
    );
    const q = r.rows[0]?.q;
    if (q) {
      const name = pick(q, ['name', 'quarter', 'label', 'quartier', 'city', 'ville']);
      if (name) {
        const city = pick(q, ['city', 'ville']);
        return {
          id: q.id === undefined || q.id === null ? null : String(q.id),
          name,
          city: city === name ? null : city,
          country: pick(q, ['country', 'pays', 'country_code']),
        };
      }
    }
  }
  const r = await db.query<{ quarter: string | null }>('SELECT quarter FROM profiles WHERE user_id = $1', [userId]);
  const text = r.rows[0]?.quarter?.trim();
  return text ? { id: null, name: text, city: null, country: null } : null;
}

export interface MedalCounts {
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

/** Médailles du joueur (or, argent, bronze). */
export async function medalsOf(db: Sql, userId: string): Promise<MedalCounts> {
  const out: MedalCounts = { gold: 0, silver: 0, bronze: 0, total: 0 };
  if (!(await tableExists(db, 'medals'))) return out;
  const r = await db.query<{ kind: string; n: number }>(
    'SELECT kind::text AS kind, count(*)::int AS n FROM medals WHERE user_id = $1 GROUP BY kind',
    [userId],
  );
  for (const row of r.rows) {
    const kind = row.kind.toLowerCase();
    if (kind === 'or' || kind === 'gold') out.gold += row.n;
    else if (kind === 'argent' || kind === 'silver') out.silver += row.n;
    else if (kind === 'bronze') out.bronze += row.n;
    out.total += row.n;
  }
  return out;
}
