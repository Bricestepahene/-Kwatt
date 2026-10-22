/**
 * Routes /v1/shop : catalogue vu par le joueur et achats (profils seulement, planche Matrice :
 * « Acheter un avatar · invité non · profil oui · cauris gagnés au jeu »).
 *
 *   GET  /v1/shop/items  ?kinds=avatar_preset,frame
 *   POST /v1/shop/buy    { itemCode } ou { itemCodes: [...] }
 */
import { BuyRequestSchema, ShopCatalogQuerySchema, type ShopCatalogResponse } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../auth/plugin.js';
import { balanceOf } from '../economy/ledger.js';
import { listCatalog } from './catalog.js';
import { buyItems } from './service.js';

const shopRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/shop/items', { preHandler: app.requireMember }, async (req): Promise<ShopCatalogResponse> => {
    const { kinds } = parse(ShopCatalogQuerySchema, req.query);
    const userId = requireAuth(req).userId;
    const [catalog, balance] = await Promise.all([listCatalog(app.db, userId, kinds), balanceOf(app.db, userId)]);
    return { items: catalog.items, balance, rank: catalog.rank };
  });

  app.post(
    '/v1/shop/buy',
    { preHandler: app.requireMember, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const body = parse(BuyRequestSchema, req.body);
      const codes = 'itemCode' in body ? [body.itemCode] : body.itemCodes;
      return buyItems(app.db, requireAuth(req).userId, codes);
    },
  );

  // Export des données : objets possédés (achats, récompenses, numéros d'exemplaire).
  app.accounts.addExportSection('items', async (db, userId) => {
    const r = await db.query(
      `SELECT i.code, i.kind, o.serial, o.source, o.acquired_at AS "acquiredAt"
         FROM owned_items o JOIN items i ON i.id = o.item_id WHERE o.user_id = $1 ORDER BY o.acquired_at`,
      [userId],
    );
    return r.rows;
  });

  // Effacement à J+30 : les objets possédés disparaissent (les numéros d'exemplaire ne sont
  // jamais réattribués : le compteur de l'édition ne redescend pas).
  app.accounts.onErase('items', async (tx, userId) => {
    await tx.query('DELETE FROM owned_items WHERE user_id = $1', [userId]);
  });
};

export default shopRoutes;
