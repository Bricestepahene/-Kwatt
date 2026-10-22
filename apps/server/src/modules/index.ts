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
import shareRoutes from './share/routes.js';

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
  { name: 'accounts', routes: accountsRoutes },
];
