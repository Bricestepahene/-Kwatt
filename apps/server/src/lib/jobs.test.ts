import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test/db.js';
import { ManualClock } from './clock.js';
import { JobRunner } from './jobs.js';

let db: TestDatabase;
/** Journal muet (celui d'une instance Fastify sans journal). */
const log = Fastify({ logger: false }).log;
const clock = new ManualClock(new Date('2026-10-22T08:00:00Z'));

beforeAll(async () => {
  db = await createTestDatabase('jobs');
});
afterAll(async () => {
  await db.drop();
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined as void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('tâches planifiées', () => {
  it('refuse un nom invalide, un doublon, un intervalle trop court', () => {
    const runner = new JobRunner(db.pool, log, clock);
    expect(() => runner.register('Mauvais Nom', 60_000, async () => undefined)).toThrow(/invalide/);
    runner.register('ok.job', 60_000, async () => undefined);
    expect(() => runner.register('ok.job', 60_000, async () => undefined)).toThrow(/déjà/);
    expect(() => runner.register('trop.court', 10, async () => undefined)).toThrow(/court/);
    expect(runner.names()).toEqual(['ok.job']);
  });

  it('exécute la tâche avec l\'heure de l\'horloge et garde la trace dans job_runs', async () => {
    const runner = new JobRunner(db.pool, log, clock);
    const seen: Date[] = [];
    runner.register('trace.ok', 60_000, async ({ now }) => {
      seen.push(now);
    });
    expect(await runner.runNow('trace.ok')).toBe(true);
    expect(await runner.runNow('trace.ok')).toBe(true);
    expect(seen).toEqual([clock.now(), clock.now()]);
    const r = await db.pool.query('SELECT run_count, last_error, last_finished_at FROM job_runs WHERE name = $1', ['trace.ok']);
    expect(r.rows[0]).toMatchObject({ run_count: 2, last_error: null });
  });

  it('une erreur est gardée dans job_runs, jamais propagée', async () => {
    const runner = new JobRunner(db.pool, log, clock);
    runner.register('trace.fail', 60_000, async () => {
      throw new Error('panne de test');
    });
    expect(await runner.runNow('trace.fail')).toBe(true);
    const r = await db.pool.query('SELECT last_error FROM job_runs WHERE name = $1', ['trace.fail']);
    expect(r.rows[0]?.last_error).toBe('panne de test');
  });

  it('une seule exécution à la fois, ici ou sur un autre serveur (verrou consultatif)', async () => {
    const gate = deferred();
    let runs = 0;
    const fn = async () => {
      runs++;
      await gate.promise;
    };
    const serverA = new JobRunner(db.pool, log, clock);
    const serverB = new JobRunner(db.pool, log, clock);
    serverA.register('exclusive', 60_000, fn);
    serverB.register('exclusive', 60_000, fn);

    const first = serverA.runNow('exclusive');
    // Laisse la première exécution prendre le verrou.
    await new Promise((r) => setTimeout(r, 50));
    expect(await serverA.runNow('exclusive')).toBe(false);
    expect(await serverB.runNow('exclusive')).toBe(false);
    gate.resolve();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
    // Verrou rendu : l'autre serveur peut passer.
    expect(await serverB.runNow('exclusive')).toBe(true);
    expect(runs).toBe(2);
  });

  it('une tâche inconnue est refusée', async () => {
    const runner = new JobRunner(db.pool, log, clock);
    await expect(runner.runNow('inconnue')).rejects.toThrow(/inconnue/);
  });

  it('stop attend la fin de l\'exécution en cours', async () => {
    const runner = new JobRunner(db.pool, log, clock);
    const gate = deferred();
    let finished = false;
    runner.register('long', 60_000, async () => {
      await gate.promise;
      finished = true;
    });
    runner.start();
    const running = runner.runNow('long');
    await new Promise((r) => setTimeout(r, 30));
    const stopped = runner.stop();
    gate.resolve();
    await stopped;
    expect(finished).toBe(true);
    expect(await running).toBe(true);
  });
});
