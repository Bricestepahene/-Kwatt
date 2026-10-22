/**
 * Service statique des médias : GET /media/<chemin>.
 */
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

const mediaRoutes: FastifyPluginAsync = async (app) => {
  await app.media.init();
  await app.register(fastifyStatic, {
    root: app.media.dir,
    prefix: '/media/',
    decorateReply: false,
    index: false,
    list: false,
    dotfiles: 'deny',
    maxAge: '7d',
  });
};

export default mediaRoutes;
