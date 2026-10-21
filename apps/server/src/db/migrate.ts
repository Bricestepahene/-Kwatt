/**
 * Migrations SQL numérotées (`db/migrations/NNNN_nom.sql`), appliquées dans l'ordre.
 *
 * - Table `schema_migrations` : version, nom, empreinte SHA-256, date.
 * - Chaque fichier s'exécute dans sa propre transaction (pas de `CREATE INDEX CONCURRENTLY`).
 * - Un verrou consultatif empêche deux lancements simultanés (deux conteneurs, CI…).
 * - Un fichier déjà appliqué ne se modifie jamais : on en ajoute un nouveau (`ALTER TABLE`).
 *   Une empreinte différente est signalée dans le journal.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';

/** Clé du verrou consultatif des migrations (constante arbitraire propre à Kwatt). */
const MIGRATION_LOCK_KEY = 7_402_001;
const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  version: string;
  name: string;
  path: string;
}

export interface MigrateLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface MigrateResult {
  applied: string[];
  skipped: number;
}

/** Liste les fichiers de migration, triés ; refuse deux fichiers de même numéro. */
export async function listMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files: MigrationFile[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith('.sql')) continue;
    const m = FILE_PATTERN.exec(name);
    if (!m?.[1]) throw new Error(`Nom de migration invalide : ${name} (attendu NNNN_nom_en_minuscules.sql)`);
    files.push({ version: m[1], name, path: join(dir, name) });
  }
  const seen = new Map<string, string>();
  for (const f of files) {
    const other = seen.get(f.version);
    if (other) throw new Error(`Deux migrations portent le numéro ${f.version} : ${other} et ${f.name}`);
    seen.set(f.version, f.name);
  }
  return files;
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Applique les migrations manquantes. */
export async function migrate(pool: pg.Pool, dir: string, log?: MigrateLogger): Promise<MigrateResult> {
  const files = await listMigrations(dir);
  const client = await pool.connect();
  const applied: string[] = [];
  let skipped = 0;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = await client.query<{ version: string; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM schema_migrations',
    );
    const byVersion = new Map(done.rows.map((r) => [r.version, r]));
    const known = new Set(files.map((f) => f.version));
    for (const r of done.rows) {
      if (!known.has(r.version)) log?.warn(`Migration ${r.name} appliquée en base mais absente du dossier.`);
    }

    for (const file of files) {
      const sql = await readFile(file.path, 'utf8');
      const sum = checksum(sql);
      const previous = byVersion.get(file.version);
      if (previous) {
        skipped++;
        if (previous.checksum !== sum) {
          log?.warn(`La migration ${file.name} a changé depuis son application : ajoutez plutôt une nouvelle migration.`);
        }
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          file.version,
          file.name,
          sum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Échec de la migration ${file.name} : ${message}`, { cause: err });
      }
      applied.push(file.name);
      log?.info(`Migration appliquée : ${file.name}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return { applied, skipped };
}
