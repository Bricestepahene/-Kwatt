/**
 * Démarrage du serveur Kwatt : `pnpm --filter @kwatt/server dev` (développement)
 * ou `node dist/main.js` (production, image Docker).
 */
import { buildApp } from './app.js';
import { ConfigError, loadConfig, loadDotEnv, type Config } from './config.js';
import { migrate } from './db/migrate.js';

async function main(): Promise<void> {
  loadDotEnv();
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await buildApp({ config });
  if (config.migrateOnStart) {
    const result = await migrate(app.db, config.migrationsDir, {
      info: (m) => app.log.info(m),
      warn: (m) => app.log.warn(m),
    });
    app.log.info({ applied: result.applied.length, skipped: result.skipped }, 'migrations vérifiées');
  }

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'arrêt du serveur');
    app
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        app.log.error({ err }, 'arrêt en erreur');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
