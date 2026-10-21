/**
 * Aides de test du serveur, pour toutes les équipes :
 *
 *   import { buildTestApp, createMember, createGuest } from '../../test/helpers.js';
 *
 *   let t: TestApp;
 *   beforeAll(async () => { t = await buildTestApp({ suite: 'rooms' }); });
 *   afterAll(async () => { await t.close(); });
 *
 *   it('…', async () => {
 *     const alice = await createMember(t, { verified: true });
 *     const res = await t.app.inject({ method: 'GET', url: '/v1/me', headers: alice.headers });
 *   });
 *
 * - base PostgreSQL dédiée, migrée, supprimée à la fin ;
 * - e-mails et push en mémoire (`t.mail`, `t.push`), horloge réglable (`t.clock`) ;
 * - `listen: true` pour les tests WebSocket (`t.wsUrl(token)`, voir ws-client.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthSessionResponse, Device, Me, RegisterResponse } from '@kwatt/protocol';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig, type Config } from '../config.js';
import { ManualClock } from '../lib/clock.js';
import { MemoryTransport } from '../lib/mailer.js';
import { MemoryPushSender } from '../modules/notifications/push.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { TestWsClient } from './ws-client.js';

export { TestWsClient } from './ws-client.js';

export interface TestAppOptions {
  /** Nom court de la suite (nom de la base de test). */
  suite?: string;
  /** Variables d'environnement en plus (ex. { RATE_LIMIT_AUTH_PER_MIN: '5' }). */
  env?: Record<string, string>;
  /** Écoute sur un port libre (nécessaire pour les WebSocket). */
  listen?: boolean;
  /** Routes ou gestionnaires en plus, ajoutés avant le démarrage (tests des décorateurs…). */
  extend?: (app: FastifyInstance) => void | Promise<void>;
}

export interface TestApp {
  app: FastifyInstance;
  db: TestDatabase;
  config: Config;
  clock: ManualClock;
  mail: MemoryTransport;
  push: MemoryPushSender;
  /** Adresse HTTP quand `listen: true`. */
  baseUrl: string | null;
  wsUrl(token: string): string;
  close(): Promise<void>;
}

export const TEST_PASSWORD = 'motdepasse-solide-237';

export async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const db = await createTestDatabase(options.suite ?? 'server');
  const mediaDir = await mkdtemp(join(tmpdir(), 'kwatt-media-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.url,
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdefghijklmnop',
    JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdefghijklmno',
    ARGON2_MEMORY_KIB: '1024',
    RATE_LIMIT_AUTH_PER_MIN: '1000',
    RATE_LIMIT_GLOBAL_PER_MIN: '100000',
    JOBS_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    MEDIA_DIR: mediaDir,
    PRESENCE_GRACE_MS: '0',
    PUBLIC_BASE_URL: 'http://kwatt.test',
    ...options.env,
  });
  const clock = new ManualClock();
  const mail = new MemoryTransport();
  const push = new MemoryPushSender();
  const app = await buildApp({ config, pool: db.pool, clock, mailTransport: mail, pushSender: push, logger: false });
  if (options.extend) await options.extend(app);
  let baseUrl: string | null = null;
  if (options.listen) {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
  } else {
    await app.ready();
  }
  return {
    app,
    db,
    config,
    clock,
    mail,
    push,
    baseUrl,
    wsUrl(token: string) {
      if (!baseUrl) throw new Error('buildTestApp({ listen: true }) nécessaire pour les WebSocket');
      return `${baseUrl.replace('http', 'ws')}/v1/ws?token=${encodeURIComponent(token)}`;
    },
    async close() {
      await app.close();
      await db.drop();
      await rm(mediaDir, { recursive: true, force: true });
    },
  };
}

let counter = 0;
/** Suffixe unique pour pseudos et adresses de test. */
export function uniq(): string {
  counter++;
  return `${counter}${randomBytes(3).toString('hex')}`;
}

export function testDevice(overrides: Partial<Device> = {}): Device {
  return { installId: `install-${uniq()}`, platform: 'android', ...overrides };
}

export interface TestUser {
  userId: string;
  accessToken: string;
  refreshToken: string;
  device: Device;
  headers: { authorization: string };
  me: Me;
}

export interface TestMember extends TestUser {
  pseudo: string;
  email: string;
  password: string;
}

function asUser(body: AuthSessionResponse, device: Device): TestUser {
  return {
    userId: body.me.id,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    device,
    headers: { authorization: `Bearer ${body.accessToken}` },
    me: body.me,
  };
}

export async function createGuest(t: TestApp, device: Device = testDevice()): Promise<TestUser> {
  const res = await t.app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { device } });
  if (res.statusCode !== 201) throw new Error(`invité non créé : ${res.statusCode} ${res.body}`);
  return asUser(res.json<AuthSessionResponse>(), device);
}

export interface MemberOptions {
  pseudo?: string;
  email?: string;
  password?: string;
  birthYear?: number;
  locale?: 'fr' | 'en';
  device?: Device;
  /** Saisit le code reçu par e-mail. */
  verified?: boolean;
  /** Convertit ce compte invité au lieu de créer un nouveau compte. */
  fromGuest?: TestUser;
}

export async function createMember(t: TestApp, options: MemberOptions = {}): Promise<TestMember> {
  const id = uniq();
  const pseudo = options.pseudo ?? `joueur_${id}`.slice(0, 20);
  const email = options.email ?? `joueur.${id}@example.com`;
  const password = options.password ?? TEST_PASSWORD;
  const device = options.device ?? options.fromGuest?.device ?? testDevice();
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    headers: options.fromGuest?.headers ?? {},
    payload: {
      pseudo,
      email,
      password,
      birthYear: options.birthYear ?? 1990,
      acceptTerms: true,
      ...(options.locale ? { locale: options.locale } : {}),
      device,
    },
  });
  if (res.statusCode !== 201) throw new Error(`profil non créé : ${res.statusCode} ${res.body}`);
  let user = asUser(res.json<RegisterResponse>(), device);
  if (options.verified) {
    await t.app.mailer.idle();
    const code = t.mail.lastCode(email);
    const v = await t.app.inject({ method: 'POST', url: '/v1/auth/email/verify', headers: user.headers, payload: { code } });
    if (v.statusCode !== 200) throw new Error(`vérification impossible : ${v.statusCode} ${v.body}`);
    user = { ...user, me: v.json<Me>() };
  }
  return { ...user, pseudo, email, password };
}

/** Ouvre une WebSocket pour un joueur (application lancée avec `listen: true`). */
export function connectWs(t: TestApp, user: Pick<TestUser, 'accessToken'>): Promise<TestWsClient> {
  return TestWsClient.connect(t.wsUrl(user.accessToken));
}
