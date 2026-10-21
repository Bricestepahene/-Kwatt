/**
 * Curseurs de pagination opaques : (date, identifiant) du dernier élément rendu, en base64url.
 * Tri du plus récent au plus ancien : on lit ensuite les éléments « avant » ce couple.
 */
import { AppError } from './errors.js';

export interface CursorPosition {
  at: Date;
  id: string;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorPosition | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string') {
      const at = new Date(value[0]);
      if (!Number.isNaN(at.getTime()) && /^[0-9a-f-]{36}$/i.test(value[1])) return { at, id: value[1] };
    }
  } catch {
    // curseur illisible : erreur ci-dessous
  }
  throw new AppError('common.validation', 400, { issues: [{ path: 'cursor', code: 'invalid_cursor' }] });
}

/** Coupe la liste à `limit` et calcule le curseur suivant. */
export function pageOf<T>(rows: T[], limit: number, key: (row: T) => { at: Date; id: string }): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > limit && last !== undefined ? encodeCursor(key(last).at, key(last).id) : null;
  return { items, nextCursor };
}
