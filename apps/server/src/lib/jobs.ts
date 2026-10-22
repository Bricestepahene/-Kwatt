/**
 * Tâches planifiées dans le processus : `app.registerJob(name, everyMs, fn)`.
 * Chaque exécution prend un verrou consultatif PostgreSQL (pg_try_advisory_lock) : si deux
 * serveurs tournent, une seule exécution à la fois. La table `job_runs` garde la trace.
 */
import { randomInt } from 'node:crypto';
import type { Pool } from '../db/pool.js';
import type { Clock } from './clock.js';
import type { Logger } from './logger.js';

export interface JobContext {
  db: Pool;
  log: Logger;
  now: Date;
}

export type JobFn = (ctx: JobContext) => Promise<void>;

interface Job {
  name: string;
  everyMs: number;
  fn: JobFn;
  timer: NodeJS.Timeout | null;
  running: Promise<boolean> | null;
}

export class JobRunner {
  private readonly jobs = new Map<string, Job>();
  private started = false;

  constructor(
    private readonly db: Pool,
    private readonly log: Logger,
    private readonly clock: Clock,
  ) {}

  register(name: string, everyMs: number, fn: JobFn): void {
    if (!/^[a-z][a-z0-9_.-]*$/.test(name)) throw new Error(`Nom de tâche invalide : ${name}`);
    if (this.jobs.has(name)) throw new Error(`Tâche déjà enregistrée : ${name}`);
    if (everyMs < 1000) throw new Error(`Intervalle trop court pour ${name}`);
    const job: Job = { name, everyMs, fn, timer: null, running: null };
    this.jobs.set(name, job);
    if (this.started) this.schedule(job);
  }

  names(): string[] {
    return [...this.jobs.keys()];
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const job of this.jobs.values()) this.schedule(job);
  }

  private schedule(job: Job): void {
    // Premier passage peu après le démarrage (décalé pour ne pas tout lancer en même temps).
    const first = Math.min(job.everyMs, 5_000 + randomInt(0, 10_000));
    const tick = () => {
      void this.runNow(job.name);
      job.timer = setTimeout(tick, job.everyMs);
      job.timer.unref();
    };
    job.timer = setTimeout(tick, first);
    job.timer.unref();
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
    }
    await Promise.all([...this.jobs.values()].map((j) => j.running ?? Promise.resolve(false)));
  }

  /**
   * Exécute une tâche tout de suite. Rend false si elle tourne déjà (ici ou sur un autre serveur).
   * Une erreur est journalisée et gardée dans job_runs, jamais propagée.
   */
  runNow(name: string): Promise<boolean> {
    const job = this.jobs.get(name);
    if (!job) return Promise.reject(new Error(`Tâche inconnue : ${name}`));
    if (job.running) return Promise.resolve(false);
    job.running = this.execute(job).finally(() => {
      job.running = null;
    });
    return job.running;
  }

  private async execute(job: Job): Promise<boolean> {
    let client;
    try {
      client = await this.db.connect();
    } catch (err) {
      this.log.error({ err, job: job.name }, 'tâche planifiée : base injoignable');
      return false;
    }
    const lockKey = `kwatt.job.${job.name}`;
    try {
      const lock = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok', [lockKey]);
      if (!lock.rows[0]?.ok) return false;
      const startedAt = this.clock.now();
      await this.db.query(
        `INSERT INTO job_runs (name, last_started_at) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET last_started_at = $2`,
        [job.name, startedAt],
      );
      let error: string | null = null;
      try {
        await job.fn({ db: this.db, log: this.log, now: startedAt });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        this.log.error({ err, job: job.name }, 'tâche planifiée en échec');
      }
      await this.db.query(
        'UPDATE job_runs SET last_finished_at = $2, last_error = $3, run_count = run_count + 1 WHERE name = $1',
        [job.name, this.clock.now(), error],
      );
      return true;
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]).catch(() => undefined);
      client.release();
    }
  }
}
