/**
 * Assemblage du serveur : buildApp(options) rend une instance Fastify prête à écouter.
 * Les tests construisent la leur avec une base dédiée, un e-mail et un push en mémoire.
 */
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { WS_MAX_PAYLOAD_BYTES } from '@kwatt/protocol';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { createPool, type Pool } from './db/pool.js';
import { systemClock, type Clock } from './lib/clock.js';
import { JobRunner } from './lib/jobs.js';
import { REDACT_PATHS, scrubUrl } from './lib/logger.js';
import { LogTransport, Mailer, SmtpTransport, type MailTransport } from './lib/mailer.js';
import { PasswordHasher } from './modules/auth/passwords.js';
import { authPlugin } from './modules/auth/plugin.js';
import { TokenService } from './modules/auth/tokens.js';
import { modules } from './modules/index.js';
import { MediaStore } from './modules/media/store.js';
import { createMachinePlayer } from './modules/games/machine.js';
import { GamesService } from './modules/games/service.js';
import { AccountRegistry } from './modules/me/registry.js';
import { ExpoPushSender, type PushSender } from './modules/notifications/push.js';
import { NotificationService } from './modules/notifications/service.js';
import { securityPlugin } from './plugins/security.js';
import { RealtimeHub } from './realtime/hub.js';
import './types.js';

export interface BuildAppOptions {
  config: Config;
  /** Pool existant (tests) ; sinon créé depuis DATABASE_URL et fermé avec le serveur. */
  pool?: Pool;
  clock?: Clock;
  mailTransport?: MailTransport;
  pushSender?: PushSender;
  /** Journal : true/false ou options pino (défaut : niveau LOG_LEVEL). */
  logger?: LoggerOption;
}

type LoggerOption = Exclude<FastifyServerOptions['logger'], undefined>;

function loggerOptions(config: Config): LoggerOption {
  return {
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[masqué]' },
    serializers: {
      req: (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: scrubUrl(req.url), ip: req.ip }),
    },
    ...(config.env === 'development' ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } } : {}),
  };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({
    logger: options.logger ?? loggerOptions(config),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    // Pas de ligne de journal par requête en test, ni pour la sonde de santé (toutes les 30 s).
    logController: new LogController({
      disableRequestLogging: (req) => config.env === 'test' || req.url === '/v1/health',
    }),
  });

  const clock = options.clock ?? systemClock;
  const pool = options.pool ?? createPool(config.databaseUrl, config.databasePoolMax, app.log);
  const ownsPool = options.pool === undefined;
  const transport = options.mailTransport ?? (config.smtp ? new SmtpTransport(config.smtp, config.mailFrom) : new LogTransport(app.log));
  const realtime = new RealtimeHub({
    log: app.log,
    clock,
    pingIntervalMs: config.wsPingIntervalMs,
    presenceGraceMs: config.presenceGraceMs,
  });
  const jobs = new JobRunner(pool, app.log, clock);

  app.decorate('config', config);
  app.decorate('db', pool);
  app.decorate('clock', clock);
  app.decorate('mailer', new Mailer(transport, app.log));
  app.decorate('tokens', new TokenService(config.jwtAccessSecret, config.accessTokenTtlSeconds, clock));
  app.decorate('passwords', new PasswordHasher(config.argon2MemoryKib));
  app.decorate('realtime', realtime);
  app.decorate('registerWsHandler', realtime.registerHandler.bind(realtime));
  app.decorate(
    'notifications',
    new NotificationService({
      db: pool,
      hub: realtime,
      push: options.pushSender ?? new ExpoPushSender(config.push.url, config.push.accessToken, app.log),
      pushEnabled: config.push.enabled,
      clock,
      log: app.log,
    }),
  );
  app.decorate('jobs', jobs);
  app.decorate('registerJob', jobs.register.bind(jobs));
  app.decorate('accounts', new AccountRegistry());
  app.decorate('media', new MediaStore(config.mediaDir, config.publicBaseUrl, config.mediaMaxBytes));
  // Parties en ligne (C3) : partagées par les salons, les défis, les ligues et la communauté.
  app.decorate(
    'games',
    new GamesService({
      db: pool,
      clock,
      log: app.log,
      hub: realtime,
      machine: createMachinePlayer({ ludoAiUrl: config.env === 'test' ? null : config.ludoAiUrl, log: app.log }),
      machineDelayMs: config.env === 'test' ? 0 : 700,
    }),
  );

  await app.register(securityPlugin);
  await app.register(websocket, { options: { maxPayload: WS_MAX_PAYLOAD_BYTES } });
  await app.register(multipart, { limits: { fileSize: config.mediaMaxBytes, files: 1, fields: 10 } });
  await app.register(authPlugin);
  for (const m of modules) await app.register(m.routes);

  app.addHook('onReady', async () => {
    realtime.start();
    if (config.jobsEnabled) jobs.start();
  });
  app.addHook('preClose', async () => {
    realtime.stop();
  });
  app.addHook('onClose', async () => {
    await jobs.stop();
    await app.notifications.idle();
    await app.mailer.idle();
    if (ownsPool) await pool.end();
  });

  for (const warning of config.warnings) app.log.warn(warning);
  return app;
}
