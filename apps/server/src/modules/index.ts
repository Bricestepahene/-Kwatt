/**
 * Registre des modules du serveur (SPEC §3). Un module = `src/modules/<nom>/` avec
 * `routes.ts` (plugin Fastify qui déclare ses routes, ses messages temps réel avec
 * app.registerWsHandler, ses tâches avec app.registerJob, ses crochets de compte avec
 * app.accounts…), `service.ts` et ses tests.
 *
 * Pour ajouter un module : importer son plugin et ajouter UNE ligne au tableau ci-dessous.
 * L'ordre compte peu ; les modules de fondation restent en tête.
 */
import type { FastifyPluginAsync } from 'fastify';
import realtimeRoutes from '../realtime/routes.js';
import accountsRoutes from './accounts/routes.js';
import adminRoutes from './admin/routes.js';
import authRoutes from './auth/routes.js';
import economyRoutes from './economy/routes.js';
import healthRoutes from './health/routes.js';
import mediaRoutes from './media/routes.js';
import meRoutes from './me/routes.js';
import notificationRoutes from './notifications/routes.js';
import profilesRoutes from './profiles/routes.js';
import shareRoutes from './share/routes.js';
import shopRoutes from './shop/routes.js';
import ludoRoutes from './ludo/routes.js';
import ratingsRoutes from './ratings/routes.js';
import machineRoutes from './machine/routes.js';
import puzzlesRoutes from './puzzles/routes.js';
import gamesRoutes from './games/routes.js';
import leaguesRoutes from './leagues/routes.js';

export interface KwattModule {
  name: string;
  routes: FastifyPluginAsync;
}

export const modules: KwattModule[] = [
  { name: 'health', routes: healthRoutes },
  { name: 'auth', routes: authRoutes },
  { name: 'me', routes: meRoutes },
  { name: 'economy', routes: economyRoutes },
  { name: 'notifications', routes: notificationRoutes },
  { name: 'realtime', routes: realtimeRoutes },
  { name: 'media', routes: mediaRoutes },
  { name: 'share', routes: shareRoutes },
  { name: 'admin', routes: adminRoutes },
  { name: 'shop', routes: shopRoutes },
  { name: 'profiles', routes: profilesRoutes },
  { name: 'accounts', routes: accountsRoutes },
  { name: 'ludo', routes: ludoRoutes },
  { name: 'ratings', routes: ratingsRoutes },
  { name: 'machine', routes: machineRoutes },
  { name: 'puzzles', routes: puzzlesRoutes },
  { name: 'games', routes: gamesRoutes },
  { name: 'leagues', routes: leaguesRoutes },
];
