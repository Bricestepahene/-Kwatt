/**
 * Quartiers (écran 05, D-11) : recherche dans la liste, choix du joueur, règle de la saison.
 *
 * Règle : le premier choix est libre ; ensuite un CHANGEMENT par saison (mois civil, heure du
 * Cameroun, @kwatt/domain). Reprendre le même quartier ne compte pas comme un changement.
 */
import { canChangeQuarter, monthBounds, seasonKey } from '@kwatt/domain';
import type { MyQuarterResponse, Quarter } from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';

/**
 * Texte de recherche comme la colonne quarters.search_key : minuscules, sans accents,
 * apostrophes et tirets changés en espaces, espaces simples.
 */
export function normalizeSearch(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Échappe les caractères spéciaux de LIKE (« % », « _ », « \ »). */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface QuarterRow {
  id: string;
  country: string;
  city: string;
  city_en: string | null;
  name: string | null;
  players: number;
}

function toQuarter(row: QuarterRow): Quarter {
  return { id: row.id, country: row.country, city: row.city, cityEn: row.city_en, name: row.name, players: row.players };
}

const SELECT_QUARTER = `
  SELECT q.id, q.country, q.city, q.city_en, q.name,
         (SELECT count(*)::int FROM profiles p WHERE p.quarter = q.id) AS players
    FROM quarters q`;

/**
 * Recherche sans accents ni capitales, dans le nom du quartier et de la ville (« deido »,
 * « ndjamena » trouve « N'Djamena »). Sans texte : les quartiers les plus peuplés, puis les
 * villes du Cameroun. Les débuts de mot passent devant.
 */
export async function searchQuarters(db: Sql, query: { q?: string | undefined; country?: string | undefined; limit: number }): Promise<Quarter[]> {
  const text = normalizeSearch(query.q ?? '');
  const params: unknown[] = [];
  const where: string[] = ['q.active'];
  if (query.country) {
    params.push(query.country);
    where.push(`q.country = $${params.length}`);
  }
  let rank = '0';
  if (text) {
    params.push(likeEscape(text));
    const p = `$${params.length}`;
    params.push(likeEscape(text.replace(/ /g, '')));
    const compact = `$${params.length}`;
    where.push(`(q.search_key LIKE '%' || ${p} || '%' OR replace(q.search_key, ' ', '') LIKE '%' || ${compact} || '%')`);
    // 0 : le quartier (ou la ville seule) commence par le texte ; 1 : un mot commence par le texte ; 2 : ailleurs.
    rank = `CASE WHEN ltrim(q.search_key) LIKE ${p} || '%' THEN 0
                 WHEN q.search_key LIKE '% ' || ${p} || '%' THEN 1 ELSE 2 END`;
  }
  params.push(query.limit);
  const r = await db.query<QuarterRow & { rank: number }>(
    `SELECT id, country, city, city_en, name, players FROM (
       SELECT q.id, q.country, q.city, q.city_en, q.name, ${rank} AS rank,
              (SELECT count(*)::int FROM profiles p WHERE p.quarter = q.id) AS players
         FROM quarters q
        WHERE ${where.join(' AND ')}
     ) found
     ORDER BY rank, players DESC, (country = 'CM') DESC, (name IS NULL) DESC, city, name
     LIMIT $${params.length}`,
    params,
  );
  return r.rows.map(toQuarter);
}

export async function findQuarter(db: Sql, id: string, { activeOnly = false } = {}): Promise<Quarter | null> {
  const r = await db.query<QuarterRow>(`${SELECT_QUARTER} WHERE q.id = $1 ${activeOnly ? 'AND q.active' : ''}`, [id]);
  const row = r.rows[0];
  return row ? toQuarter(row) : null;
}

/** Début de la saison suivante si un changement a déjà eu lieu cette saison, sinon null. */
export function nextQuarterChangeAt(changedAt: Date | null, now: Date): Date | null {
  if (changedAt === null || canChangeQuarter(changedAt.getTime(), now.getTime())) return null;
  return new Date(monthBounds(seasonKey(now.getTime())).end);
}

export interface ProfileQuarterRow {
  quarter: string | null;
  quarter_since: Date | null;
  quarter_changed_at: Date | null;
}

export async function myQuarter(db: Sql, row: ProfileQuarterRow, now: Date): Promise<MyQuarterResponse> {
  return {
    quarter: row.quarter ? await findQuarter(db, row.quarter) : null,
    since: row.quarter_since ? row.quarter_since.toISOString() : null,
    nextChangeAt: nextQuarterChangeAt(row.quarter_changed_at, now)?.toISOString() ?? null,
    season: seasonKey(now.getTime()),
  };
}
