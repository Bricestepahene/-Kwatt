/**
 * Curseurs de pagination opaques : (date, identifiant) du dernier élément rendu, en base64url.
 * Tri du plus récent au plus ancien : on lit ensuite les éléments « avant » ce couple.
 *
 * La date est gardée à la MICROSECONDE (précision de PostgreSQL) : une Date JavaScript,
 * tronquée à la milliseconde, ferait sauter ou répéter des lignes écrites dans la même
 * milliseconde. Les requêtes lisent donc la date du curseur avec `cursorAt('colonne')`.
 */
import { AppError } from './errors.js';

export interface CursorPosition {
  /** Horodatage ISO 8601 en UTC, à la microseconde (à passer en `$n::timestamptz`). */
  at: string;
  id: string;
}

/** Expression SQL qui rend la colonne `column` (timestamptz) au format attendu par le curseur. */
export function cursorAt(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorPosition | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string' &&
      AT_PATTERN.test(value[0]) &&
      !Number.isNaN(Date.parse(value[0])) &&
      ID_PATTERN.test(value[1])
    ) {
      return { at: value[0], id: value[1] };
    }
  } catch {
    // curseur illisible : erreur ci-dessous
  }
  throw new AppError('common.validation', 400, { issues: [{ path: 'cursor', code: 'invalid_cursor' }] });
}

/** Coupe la liste à `limit` et calcule le curseur suivant. */
export function pageOf<T>(rows: T[], limit: number, key: (row: T) => CursorPosition): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > limit && last !== undefined ? encodeCursor(key(last).at, key(last).id) : null;
  return { items, nextCursor };
}
