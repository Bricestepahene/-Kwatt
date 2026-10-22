/**
 * Démarrage du service : `pnpm --filter @kwatt/ludo-ai-service dev`, ou
 * `node dist/main.js` dans l'image Docker (port LUDO_AI_PORT, 8090 par défaut).
 *
 * Variables : LUDO_AI_PORT (8090), HOST (0.0.0.0), LUDO_AI_MAX_BUDGET_MS (2000),
 * LUDO_AI_REQUEST_TIMEOUT_MS (10000), LOG_LEVEL (info).
 */
import { buildService } from './app.js';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`${name} invalide : ${raw}`);
    process.exit(1);
  }
  return n;
}

const port = intEnv('LUDO_AI_PORT', 8090);
const host = process.env.HOST ?? '0.0.0.0';
const app = buildService({
  maxBudgetMs: intEnv('LUDO_AI_MAX_BUDGET_MS', 2000),
  requestTimeoutMs: intEnv('LUDO_AI_REQUEST_TIMEOUT_MS', 10_000),
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

let closing = false;
const shutdown = (signal: string): void => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'arrêt du service');
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

app.listen({ host, port }).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
