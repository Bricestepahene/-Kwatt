/**
 * Ce que le serveur ajoute à Fastify (décorateurs), disponible dans tous les modules :
 *
 *   app.config, app.db, app.clock, app.mailer
 *   app.authenticate / app.requireMember / app.requireAdult / app.requireVerified  (preHandler)
 *   app.realtime (connexions, envois, sujets, présence), app.registerWsHandler(type, schema, handler)
 *   app.notifications.notify(db, userId, kind, params)
 *   app.registerJob(name, everyMs, fn), app.jobs
 *   app.accounts.onErase(…), app.accounts.addExportSection(…)
 *   app.media (dossier des fichiers envoyés, URL publique)
 *   req.auth (contexte d'authentification, après app.authenticate)
 */
import type { Config } from './config.js';
import type { Pool } from './db/pool.js';
import type { Clock } from './lib/clock.js';
import type { JobRunner } from './lib/jobs.js';
import type { Mailer } from './lib/mailer.js';
import type { AuthContext } from './modules/auth/context.js';
import type { PasswordHasher } from './modules/auth/passwords.js';
import type { TokenService } from './modules/auth/tokens.js';
import type { AccountRegistry } from './modules/me/registry.js';
import type { RoomsService } from './modules/rooms/service.js';
import type { GamesService } from './modules/games/service.js';
import type { MediaStore } from './modules/media/store.js';
import type { NotificationService } from './modules/notifications/service.js';
import type { RealtimeHub } from './realtime/hub.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Pool;
    clock: Clock;
    mailer: Mailer;
    tokens: TokenService;
    passwords: PasswordHasher;
    realtime: RealtimeHub;
    registerWsHandler: RealtimeHub['registerHandler'];
    notifications: NotificationService;
    jobs: JobRunner;
    registerJob: JobRunner['register'];
    accounts: AccountRegistry;
    media: MediaStore;
    /** Parties en ligne (contrat C3) : création, acteurs, fin de partie. */
    games: GamesService;
    /** Salons (écrans 24 et 25) : défis et autres modules y démarrent des parties. */
    rooms: RoomsService;
    /** Invité ou profil (jeton d'accès valide, session ouverte). */
    authenticate: PreHandler;
    /** Profil (pas un invité). */
    requireMember: PreHandler;
    /** Profil de 18 ans et plus. */
    requireAdult: PreHandler;
    /** Profil dont l'adresse e-mail est vérifiée. */
    requireVerified: PreHandler;
  }

  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export type { AuthContext };
