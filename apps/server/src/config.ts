/**
 * Configuration du serveur, lue dans les variables d'environnement et validée par zod.
 * Toutes les variables sont décrites dans `.env.example` (racine du dépôt).
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Racine du dépôt, déduite de l'emplacement de ce fichier (src/ ou dist/). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1' || v === 'yes'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  PUBLIC_BASE_URL: z.url().default('http://localhost:8080'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool(false),
  /** Origines web autorisées (CORS), séparées par des virgules. L'appli mobile n'en a pas besoin. */
  CORS_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  MIGRATIONS_DIR: optionalString,
  MIGRATE_ON_START: bool(false),

  JWT_ACCESS_SECRET: optionalString,
  JWT_REFRESH_SECRET: optionalString,
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Coût mémoire d'argon2id en Kio (défaut recommandé OWASP : 19 Mio). */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19456),

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  MAIL_FROM: z.string().default('Kwatt <no-reply@localhost>'),

  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().min(1).default(5),

  MEDIA_DIR: optionalString,
  MEDIA_MAX_BYTES: z.coerce.number().int().min(1024).default(5 * 1024 * 1024),
  PHOTO_AUTO_APPROVE: bool(false),

  ADMIN_TOKEN: optionalString,
  LUDO_AI_URL: z.url().default('http://localhost:8090'),

  PUSH_ENABLED: bool(true),
  EXPO_PUSH_URL: z.url().default('https://exp.host/--/api/v2/push/send'),
  EXPO_ACCESS_TOKEN: optionalString,

  JOBS_ENABLED: bool(true),
  WS_PING_INTERVAL_MS: z.coerce.number().int().min(100).default(30_000),
  PRESENCE_GRACE_MS: z.coerce.number().int().min(0).default(5_000),

  /** Lien d'installation de l'appli (page expo.dev, magasin…) affiché sur les pages de partage. */
  APP_INSTALL_URL: optionalString,
  APP_SCHEME: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]*$/)
    .default('kwatt'),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  publicBaseUrl: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  trustProxy: boolean;
  corsOrigins: string[];
  databaseUrl: string;
  databasePoolMax: number;
  migrationsDir: string;
  migrateOnStart: boolean;
  jwtAccessSecret: string;
  /** Clé HMAC des jetons de renouvellement, des jetons de réinitialisation et des codes. */
  tokenHashSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  argon2MemoryKib: number;
  smtp: { host: string; port: number; secure: boolean; user: string | undefined; password: string | undefined } | null;
  mailFrom: string;
  rateLimitGlobalPerMin: number;
  rateLimitAuthPerMin: number;
  mediaDir: string;
  mediaMaxBytes: number;
  photoAutoApprove: boolean;
  adminToken: string | null;
  ludoAiUrl: string;
  push: { enabled: boolean; url: string; accessToken: string | undefined };
  jobsEnabled: boolean;
  wsPingIntervalMs: number;
  presenceGraceMs: number;
  appInstallUrl: string | null;
  appScheme: string;
  /** Avertissements à écrire dans le journal au démarrage. */
  warnings: string[];
}

export class ConfigError extends Error {}

/** Lit et valide la configuration. Lève ConfigError avec la liste des variables en défaut. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')} : ${i.message}`);
    throw new ConfigError(`Configuration invalide :\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const warnings: string[] = [];
  const production = e.NODE_ENV === 'production';

  const secret = (name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET', value: string | undefined): string => {
    if (value !== undefined) {
      if (value.length < 32) throw new ConfigError(`${name} doit faire au moins 32 caractères (openssl rand -base64 48).`);
      return value;
    }
    if (production) throw new ConfigError(`${name} est obligatoire en production (openssl rand -base64 48).`);
    warnings.push(`${name} absent : secret aléatoire, les sessions ne survivront pas au redémarrage.`);
    return randomBytes(48).toString('base64');
  };

  if (e.ADMIN_TOKEN !== undefined && e.ADMIN_TOKEN.length < 32) {
    throw new ConfigError('ADMIN_TOKEN doit faire au moins 32 caractères (openssl rand -hex 32).');
  }
  if (e.SMTP_HOST === undefined && e.NODE_ENV !== 'test') {
    warnings.push('SMTP_HOST vide : les e-mails (codes à 6 chiffres) sont écrits dans le journal du serveur.');
  }
  if (production && !e.PUBLIC_BASE_URL.startsWith('https://')) {
    warnings.push('PUBLIC_BASE_URL devrait commencer par https:// en production.');
  }

  const migrationsDir = e.MIGRATIONS_DIR ?? join(REPO_ROOT, 'db', 'migrations');
  if (!existsSync(migrationsDir)) warnings.push(`Dossier des migrations introuvable : ${migrationsDir}`);

  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.API_PORT,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    migrationsDir,
    migrateOnStart: e.MIGRATE_ON_START,
    jwtAccessSecret: secret('JWT_ACCESS_SECRET', e.JWT_ACCESS_SECRET),
    tokenHashSecret: secret('JWT_REFRESH_SECRET', e.JWT_REFRESH_SECRET),
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    argon2MemoryKib: e.ARGON2_MEMORY_KIB,
    smtp:
      e.SMTP_HOST === undefined
        ? null
        : { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, password: e.SMTP_PASSWORD },
    mailFrom: e.MAIL_FROM,
    rateLimitGlobalPerMin: e.RATE_LIMIT_GLOBAL_PER_MIN,
    rateLimitAuthPerMin: e.RATE_LIMIT_AUTH_PER_MIN,
    mediaDir: resolve(e.MEDIA_DIR ?? join(tmpdir(), 'kwatt-media')),
    mediaMaxBytes: e.MEDIA_MAX_BYTES,
    photoAutoApprove: e.PHOTO_AUTO_APPROVE,
    adminToken: e.ADMIN_TOKEN ?? null,
    ludoAiUrl: e.LUDO_AI_URL,
    push: { enabled: e.PUSH_ENABLED, url: e.EXPO_PUSH_URL, accessToken: e.EXPO_ACCESS_TOKEN },
    jobsEnabled: e.JOBS_ENABLED,
    wsPingIntervalMs: e.WS_PING_INTERVAL_MS,
    presenceGraceMs: e.PRESENCE_GRACE_MS,
    appInstallUrl: e.APP_INSTALL_URL ?? null,
    appScheme: e.APP_SCHEME,
    warnings,
  };
}

/**
 * Charge `.env` (racine du dépôt) en développement, sans écraser les variables déjà définies.
 * En production (Docker), les variables viennent de l'environnement du conteneur.
 */
export function loadDotEnv(path: string = join(REPO_ROOT, '.env')): void {
  if (!existsSync(path)) return;
  const before = { ...process.env };
  process.loadEnvFile(path);
  for (const [k, v] of Object.entries(before)) process.env[k] = v;
}
