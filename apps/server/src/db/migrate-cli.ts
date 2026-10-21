/**
 * `pnpm db:migrate` : applique les migrations sur DATABASE_URL.
 * En production : `node dist/db/migrate-cli.js` (ou MIGRATE_ON_START=true).
 */
import pg from 'pg';
import { REPO_ROOT, loadDotEnv } from '../config.js';
import { migrate } from './migrate.js';
import { join } from 'node:path';

loadDotEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL manquant (voir .env.example).');
  process.exit(1);
}
const dir = process.env.MIGRATIONS_DIR?.trim() || join(REPO_ROOT, 'db', 'migrations');
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const result = await migrate(pool, dir, {
    info: (m) => console.log(m),
    warn: (m) => console.warn(`ATTENTION : ${m}`),
  });
  console.log(
    result.applied.length === 0
      ? `Base à jour (${result.skipped} migrations déjà appliquées).`
      : `${result.applied.length} migration(s) appliquée(s), ${result.skipped} déjà en place.`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
