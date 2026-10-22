/**
 * Base de test : chaque suite crée SA base (`<préfixe><suite>_<pid>_<aléa>`), y applique
 * toutes les migrations, puis la supprime (SPEC §8).
 *
 * Variables : TEST_DATABASE_URL (connexion d'un rôle autorisé à créer des bases ; défaut
 * DATABASE_URL, puis postgres://kwatt:kwatt@localhost:5432/kwatt) et TEST_DB_PREFIX
 * (défaut « kwatt_test_ »).
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import pg from 'pg';
import { REPO_ROOT } from '../config.js';
import { createPool, type Pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';

export interface TestDatabase {
  name: string;
  url: string;
  pool: Pool;
  drop(): Promise<void>;
}

export function adminUrl(): string {
  return process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://kwatt:kwatt@localhost:5432/kwatt';
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

export async function createTestDatabase(suite: string): Promise<TestDatabase> {
  const prefix = process.env.TEST_DB_PREFIX ?? 'kwatt_test_';
  const clean = suite.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const name = `${prefix}${clean}_${process.pid}_${randomBytes(3).toString('hex')}`.slice(0, 63);
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(adminUrl(), name);
  const pool = createPool(url, 10);
  await migrate(pool, join(REPO_ROOT, 'db', 'migrations'));
  return {
    name,
    url,
    pool,
    async drop() {
      await pool.end().catch(() => undefined);
      const c = new pg.Client({ connectionString: adminUrl() });
      await c.connect();
      try {
        // Un processus de fond de PostgreSQL (analyse automatique…) peut occuper la base un
        // court instant ; un rôle non superutilisateur ne peut pas l'interrompre : on réessaie.
        for (let attempt = 1; ; attempt++) {
          try {
            await c.query(`DROP DATABASE IF EXISTS ${c.escapeIdentifier(name)} WITH (FORCE)`);
            break;
          } catch (err) {
            const code = (err as { code?: unknown }).code;
            if ((code !== '42501' && code !== '55006') || attempt >= 20) throw err;
            await new Promise((r) => setTimeout(r, 250));
          }
        }
      } finally {
        await c.end();
      }
    },
  };
}
