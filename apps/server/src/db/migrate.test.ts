import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test/db.js';
import { listMigrations, migrate } from './migrate.js';

describe('migrations', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase('migrate');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('applique toutes les migrations et les note dans schema_migrations', async () => {
    const r = await db.pool.query<{ version: string; name: string }>('SELECT version, name FROM schema_migrations ORDER BY version');
    expect(r.rows.map((x) => x.version)).toEqual(['0001', '0002', '0003', '0004', '0005', ...r.rows.slice(5).map((x) => x.version)]);
    expect(r.rows[0]?.name).toBe('0001_init.sql');
  });

  it('un second passage ne fait rien', async () => {
    const dir = join(process.cwd(), 'db', 'migrations');
    const result = await migrate(db.pool, dir);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toBeGreaterThanOrEqual(5);
  });

  it('crée les comptes système du grand livre', async () => {
    const r = await db.pool.query<{ system_code: string }>("SELECT system_code FROM wallets WHERE kind = 'system' ORDER BY system_code");
    expect(r.rows.map((x) => x.system_code)).toEqual(['house', 'rewards', 'shop', 'welcome']);
  });

  it('refuse un UPDATE direct d\'un solde hors du grand livre', async () => {
    await expect(db.pool.query("UPDATE wallets SET balance = 1000 WHERE system_code = 'house'")).rejects.toThrow(/hors du grand livre/);
    await expect(db.pool.query("INSERT INTO wallets (kind, system_code, balance) VALUES ('system', 'triche', 50)")).rejects.toThrow(
      /naît à zéro/,
    );
  });

  describe('fichiers', () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'kwatt-migrations-'));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('refuse deux migrations du même numéro', async () => {
      await writeFile(join(dir, '0100_a.sql'), 'SELECT 1;');
      await writeFile(join(dir, '0100_b.sql'), 'SELECT 1;');
      await expect(listMigrations(dir)).rejects.toThrow(/numéro 0100/);
    });

    it('refuse un nom mal formé', async () => {
      const other = await mkdtemp(join(tmpdir(), 'kwatt-migrations-'));
      await writeFile(join(other, '12_Mauvais.sql'), 'SELECT 1;');
      await expect(listMigrations(other)).rejects.toThrow(/invalide/);
      await rm(other, { recursive: true, force: true });
    });

    it('annule une migration en échec sans la noter', async () => {
      const other = await mkdtemp(join(tmpdir(), 'kwatt-migrations-'));
      await writeFile(join(other, '0900_ok.sql'), 'CREATE TABLE essai_ok (id int);');
      await writeFile(join(other, '0901_ko.sql'), 'CREATE TABLE essai_ko (id int); SELECT * FROM table_absente;');
      await expect(migrate(db.pool, other)).rejects.toThrow(/0901_ko\.sql/);
      const r = await db.pool.query<{ version: string }>("SELECT version FROM schema_migrations WHERE version IN ('0900', '0901')");
      expect(r.rows.map((x) => x.version)).toEqual(['0900']);
      const t = await db.pool.query("SELECT to_regclass('essai_ko') AS t");
      expect(t.rows[0]).toEqual({ t: null });
      await rm(other, { recursive: true, force: true });
    });
  });
});
