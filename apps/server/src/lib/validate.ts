/**
 * Validation zod de toute entrée (corps, paramètres, requête, messages WebSocket).
 * Échec → AppError('common.validation', 400, { issues: [{ path, code }] }).
 */
import type { z } from 'zod';
import { AppError } from './errors.js';

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, 20).map((i) => ({
    path: i.path.map((p) => String(p)).join('.'),
    code: i.code,
  }));
  throw new AppError('common.validation', 400, { issues });
}
