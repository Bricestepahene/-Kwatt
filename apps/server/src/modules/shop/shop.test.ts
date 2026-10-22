import {
  BuyResponseSchema,
  FrameItemRenderSchema,
  HatItemRenderSchema,
  OutfitItemRenderSchema,
  PresetItemRenderSchema,
  ShopCatalogResponseSchema,
  SkinItemRenderSchema,
  WELCOME_BONUS,
  type BuyResponse,
  type ShopCatalogResponse,
} from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createGuest, createMember, type TestApp, type TestMember } from '../../test/helpers.js';
import { balanceOf, transfer } from '../economy/ledger.js';
import { grantItem } from './catalog.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'shop' });
});
afterAll(async () => {
  await t.close();
});

let seq = 0;
/** Crédite un joueur depuis le compte système « house » (cauris de test). */
async function credit(userId: string, amount: number): Promise<void> {
  seq++;
  await transfer(t.db.pool, {
    kind: 'admin_adjust',
    idempotencyKey: `test_credit:${userId}:${seq}`,
    entries: [
      { wallet: { system: 'house' }, amount: -amount },
      { wallet: { userId }, amount },
    ],
  });
}

async function catalog(m: TestMember, kinds?: string): Promise<ShopCatalogResponse> {
  const res = await t.app.inject({ method: 'GET', url: `/v1/shop/items${kinds ? `?kinds=${kinds}` : ''}`, headers: m.headers });
  expect(res.statusCode).toBe(200);
  return ShopCatalogResponseSchema.parse(res.json());
}

function buy(m: TestMember, payload: object) {
  return t.app.inject({ method: 'POST', url: '/v1/shop/buy', headers: m.headers, payload });
}

/** Objet de test ajouté au catalogue. */
async function addItem(code: string, fields: { price?: number | null; edition?: number | null; minRank?: string | null } = {}) {
  await t.db.pool.query(
    `INSERT INTO items (code, kind, rarity, price, edition_total, min_rank, render)
     VALUES ($1, 'avatar_preset', 'rare', $2, $3, $4, '{"skin":1,"hat":null,"outfit":"kaba","background":"ndop"}')`,
    [code, fields.price === undefined ? 100 : fields.price, fields.edition ?? null, fields.minRank ?? null],
  );
}

async function purchaseCount(userId: string): Promise<number> {
  const r = await t.db.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger_transactions t JOIN ledger_entries e ON e.tx_id = t.id
       JOIN wallets w ON w.id = e.wallet_id WHERE t.kind = 'purchase' AND w.user_id = $1`,
    [userId],
  );
  return r.rows[0]?.n ?? 0;
}

describe('catalogue de départ', () => {
  it('reprend les prix et raretés des planches Studio et Boutique', async () => {
    const m = await createMember(t);
    const { items, balance, rank } = await catalog(m);
    expect(balance).toBe(WELCOME_BONUS);
    expect(rank).toBe('apprenti');
    const by = new Map(items.map((i) => [i.code, i]));
    const price = (code: string) => by.get(code)?.price;
    expect(items.filter((i) => i.kind === 'avatar_skin')).toHaveLength(5);
    expect([price('hat_kaba'), price('hat_toghu'), price('outfit_ndop'), price('outfit_kaba'), price('outfit_toghu')]).toEqual([
      150, 600, 120, 200, 900,
    ]);
    expect([price('preset_debrouillard'), price('preset_commercante'), price('preset_balafoniste')]).toEqual([80, 120, 450]);
    expect([price('preset_reine_ludo'), price('preset_notable'), price('preset_fon')]).toEqual([600, 1500, 5000]);
    expect(by.get('preset_notable')?.rarity).toBe('epique');
    expect(by.get('preset_fon')?.rarity).toBe('legendaire');
    expect(by.get('preset_prince_wouri')).toMatchObject({ price: 2400, edition: { total: 500, sold: 0 }, rarity: 'legendaire' });
    // Pièces de base : à toi d'office ; les autres s'achètent.
    expect(by.get('hat_ndop')).toMatchObject({ owned: true, isDefault: true, price: null, buyable: false });
    expect(by.get('outfit_obom')?.owned).toBe(true);
    expect(by.get('hat_kaba')).toMatchObject({ owned: false, buyable: true, locked: false });
    for (const code of ['frame_ndop', 'frame_toghu', 'frame_kaba', 'frame_obom']) expect(by.get(code)?.owned).toBe(true);
    // Trône du Fon : débloqué à l'échelon Fon seulement, jamais en vente.
    expect(by.get('frame_trone_du_fon')).toMatchObject({ owned: false, locked: true, buyable: false, minRank: 'fon' });
  });

  it('a des données de rendu conformes au protocole', async () => {
    const m = await createMember(t);
    const { items } = await catalog(m, 'avatar_skin,avatar_hat,avatar_outfit,avatar_preset,frame');
    const schemas = {
      avatar_skin: SkinItemRenderSchema,
      avatar_hat: HatItemRenderSchema,
      avatar_outfit: OutfitItemRenderSchema,
      avatar_preset: PresetItemRenderSchema,
      frame: FrameItemRenderSchema,
    } as const;
    for (const item of items) {
      const schema = schemas[item.kind as keyof typeof schemas];
      expect(schema.safeParse(item.render).success, item.code).toBe(true);
    }
  });

  it('filtre par famille et refuse une famille inconnue', async () => {
    const m = await createMember(t);
    const { items } = await catalog(m, 'frame');
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['frame']));
    const bad = await t.app.inject({ method: 'GET', url: '/v1/shop/items?kinds=frame,nope', headers: m.headers });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('common.validation');
  });

  it('est réservé aux profils (pas aux invités)', async () => {
    const g = await createGuest(t);
    const res = await t.app.inject({ method: 'GET', url: '/v1/shop/items', headers: g.headers });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('auth.member_required');
    const b = await t.app.inject({ method: 'POST', url: '/v1/shop/buy', headers: g.headers, payload: { itemCode: 'hat_kaba' } });
    expect(b.json().error.code).toBe('auth.member_required');
  });
});

describe('achat', () => {
  it('débite par le grand livre, au compte système shop, et donne l\'objet', async () => {
    const m = await createMember(t);
    const shopBefore = (await t.db.pool.query<{ balance: number }>("SELECT balance FROM wallets WHERE system_code = 'shop'")).rows[0]
      ?.balance;
    const res = await buy(m, { itemCode: 'preset_balafoniste' });
    expect(res.statusCode).toBe(200);
    const body: BuyResponse = BuyResponseSchema.parse(res.json());
    expect(body.balance).toBe(WELCOME_BONUS - 450);
    expect(body.purchases).toEqual([expect.objectContaining({ code: 'preset_balafoniste', price: 450, serial: null, replayed: false })]);
    expect(body.items[0]).toMatchObject({ code: 'preset_balafoniste', owned: true, buyable: false });
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS - 450);
    const shopAfter = (await t.db.pool.query<{ balance: number }>("SELECT balance FROM wallets WHERE system_code = 'shop'")).rows[0]
      ?.balance;
    expect((shopAfter ?? 0) - (shopBefore ?? 0)).toBe(450);

    // Journal : mouvement « purchase » avec l'objet en détail.
    const journal = await t.app.inject({ method: 'GET', url: '/v1/wallet/journal', headers: m.headers });
    const first = journal.json().items[0];
    expect(first).toMatchObject({ kind: 'purchase', amount: -450, balanceAfter: WELCOME_BONUS - 450 });
    expect(first.meta).toEqual({ itemCode: 'preset_balafoniste', itemKind: 'avatar_preset', serial: null });
  });

  it('est idempotent : racheter le même objet rend l\'achat existant sans nouveau débit', async () => {
    const m = await createMember(t);
    const a = BuyResponseSchema.parse((await buy(m, { itemCode: 'hat_kaba' })).json());
    const b = BuyResponseSchema.parse((await buy(m, { itemCode: 'hat_kaba' })).json());
    expect(b.purchases[0]).toMatchObject({ code: 'hat_kaba', price: 150, replayed: true, txId: a.purchases[0]?.txId });
    expect(b.balance).toBe(WELCOME_BONUS - 150);
    expect(await purchaseCount(m.userId)).toBe(1);
  });

  it('deux achats simultanés du même objet par le même joueur ne débitent qu\'une fois', async () => {
    const m = await createMember(t);
    const results = await Promise.all([buy(m, { itemCode: 'outfit_kaba' }), buy(m, { itemCode: 'outfit_kaba' })]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await purchaseCount(m.userId)).toBe(1);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS - 200);
  });

  it('refuse un solde insuffisant : « Il te manque X », sans rien débiter', async () => {
    const m = await createMember(t);
    const res = await buy(m, { itemCode: 'preset_fon' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'shop.insufficient_funds', params: { price: 5000, balance: WELCOME_BONUS, missing: 5000 - WELCOME_BONUS } },
    });
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS);
    expect(await purchaseCount(m.userId)).toBe(0);
    const { items } = await catalog(m, 'avatar_preset');
    expect(items.find((i) => i.code === 'preset_fon')?.owned).toBe(false);
  });

  it('achète plusieurs pièces d\'un coup, tout ou rien', async () => {
    const m = await createMember(t);
    // 150 + 900 = 1 050 > 500 : rien n'est acheté.
    const refused = await buy(m, { itemCodes: ['hat_kaba', 'outfit_toghu'] });
    expect(refused.json().error).toEqual({ code: 'shop.insufficient_funds', params: { price: 1050, balance: 500, missing: 550 } });
    expect(await purchaseCount(m.userId)).toBe(0);
    // 150 + 120 = 270 : les deux.
    const ok = BuyResponseSchema.parse((await buy(m, { itemCodes: ['outfit_ndop', 'hat_kaba'] })).json());
    expect(ok.purchases.map((p) => p.code)).toEqual(['hat_kaba', 'outfit_ndop']);
    expect(ok.balance).toBe(230);
    expect(await purchaseCount(m.userId)).toBe(2);
  });

  it('refuse ce qui ne s\'achète pas, ce qui est déjà à toi et ce qui n\'existe pas', async () => {
    const m = await createMember(t);
    expect((await buy(m, { itemCode: 'hat_ndop' })).json().error).toEqual({ code: 'shop.already_owned', params: { code: 'hat_ndop' } });
    expect((await buy(m, { itemCode: 'frame_trone_du_fon' })).json().error.code).toBe('shop.not_for_sale');
    const unknown = await buy(m, { itemCode: 'objet_inconnu' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toEqual({ code: 'shop.item_not_found', params: { code: 'objet_inconnu' } });
    expect((await buy(m, { itemCode: 'Pas Un Code' })).json().error.code).toBe('common.validation');
    expect((await buy(m, { itemCode: 'hat_kaba', itemCodes: ['hat_kaba'] })).json().error.code).toBe('common.validation');
  });

  it('refuse un échelon trop bas, puis accepte une fois l\'échelon atteint', async () => {
    await addItem('test_notable_only', { price: 100, minRank: 'notable' });
    const m = await createMember(t);
    const res = await buy(m, { itemCode: 'test_notable_only' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({
      code: 'shop.rank_too_low',
      params: { code: 'test_notable_only', requiredRank: 'notable', rank: 'apprenti' },
    });
    // Force 1 482 aux dames : Niv 17, Notable (écran 09).
    await t.db.pool.query(`INSERT INTO player_ratings (user_id, variant, rating, games_played) VALUES ($1, 'dames10', 1482, 40)`, [
      m.userId,
    ]);
    expect((await buy(m, { itemCode: 'test_notable_only' })).statusCode).toBe(200);
    const { rank } = await catalog(m, 'frame');
    expect(rank).toBe('notable');
  });

  it('débloque le cadre du Fon à l\'échelon Fon (sans achat)', async () => {
    const m = await createMember(t);
    await t.db.pool.query(`INSERT INTO player_ratings (user_id, variant, rating, games_played) VALUES ($1, 'ludo_classique', 1850, 90)`, [
      m.userId,
    ]);
    const { items, rank } = await catalog(m, 'frame');
    expect(rank).toBe('fon');
    expect(items.find((i) => i.code === 'frame_trone_du_fon')).toMatchObject({ owned: true, locked: false });
  });
});

describe('éditions limitées', () => {
  it('attribue des numéros d\'exemplaire sans doublon, même en concurrence, jusqu\'à épuisement', async () => {
    await addItem('test_limited_3', { price: 10, edition: 3 });
    const buyers = await Promise.all(Array.from({ length: 7 }, () => createMember(t)));
    const results = await Promise.all(buyers.map((m) => buy(m, { itemCode: 'test_limited_3' })));
    const ok = results.filter((r) => r.statusCode === 200).map((r) => BuyResponseSchema.parse(r.json()));
    const refused = results.filter((r) => r.statusCode !== 200);
    expect(ok).toHaveLength(3);
    expect(ok.map((b) => b.purchases[0]?.serial).sort()).toEqual([1, 2, 3]);
    expect(refused.map((r) => r.json().error)).toEqual(
      Array.from({ length: 4 }, () => ({ code: 'shop.sold_out', params: { code: 'test_limited_3', total: 3 } })),
    );
    const item = await t.db.pool.query<{ edition_sold: number }>(`SELECT edition_sold FROM items WHERE code = 'test_limited_3'`);
    expect(item.rows[0]?.edition_sold).toBe(3);
    // Seuls les acheteurs servis ont été débités.
    const debited = await Promise.all(buyers.map((m) => balanceOf(t.db.pool, m.userId)));
    expect(debited.filter((b) => b === WELCOME_BONUS - 10)).toHaveLength(3);
    expect(debited.filter((b) => b === WELCOME_BONUS)).toHaveLength(4);
  });

  it('un achat refusé (solde) rend son numéro au suivant', async () => {
    await addItem('test_limited_rich', { price: 600, edition: 10 });
    const poor = await createMember(t);
    const rich = await createMember(t);
    await credit(rich.userId, 1000);
    expect((await buy(poor, { itemCode: 'test_limited_rich' })).json().error.code).toBe('shop.insufficient_funds');
    const ok = BuyResponseSchema.parse((await buy(rich, { itemCode: 'test_limited_rich' })).json());
    expect(ok.purchases[0]?.serial).toBe(1);
    expect(ok.items[0]).toMatchObject({ serial: 1, edition: { total: 10, sold: 1 } });
  });

  it('Le Prince du Wouri : exemplaire numéroté visible au journal', async () => {
    const m = await createMember(t);
    await credit(m.userId, 2000);
    const res = BuyResponseSchema.parse((await buy(m, { itemCode: 'preset_prince_wouri' })).json());
    const serial = res.purchases[0]?.serial;
    expect(serial).toBeGreaterThanOrEqual(1);
    const journal = await t.app.inject({ method: 'GET', url: '/v1/wallet/journal?limit=1', headers: m.headers });
    expect(journal.json().items[0].meta).toEqual({ itemCode: 'preset_prince_wouri', itemKind: 'avatar_preset', serial });
  });
});

describe('grantItem (récompenses des autres modules)', () => {
  it('donne un objet sans débit, une seule fois', async () => {
    await addItem('test_reward_only', { price: null });
    const m = await createMember(t);
    expect(await grantItem(t.db.pool, m.userId, 'test_reward_only', 'reward')).toEqual({
      code: 'test_reward_only',
      granted: true,
      serial: null,
    });
    expect(await grantItem(t.db.pool, m.userId, 'test_reward_only', 'reward')).toEqual({
      code: 'test_reward_only',
      granted: false,
      serial: null,
    });
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS);
    const { items } = await catalog(m, 'avatar_preset');
    expect(items.find((i) => i.code === 'test_reward_only')).toMatchObject({ owned: true, buyable: false });
  });

  it('numérote une édition limitée et refuse au-delà', async () => {
    await addItem('test_reward_limited', { price: null, edition: 1 });
    const a = await createMember(t);
    const b = await createMember(t);
    expect((await grantItem(t.db.pool, a.userId, 'test_reward_limited', 'reward')).serial).toBe(1);
    await expect(grantItem(t.db.pool, b.userId, 'test_reward_limited', 'reward')).rejects.toMatchObject({ code: 'shop.sold_out' });
    await expect(grantItem(t.db.pool, b.userId, 'nope_nope', 'reward')).rejects.toMatchObject({ code: 'shop.item_not_found' });
  });
});

describe('données du compte', () => {
  it('l\'export contient les objets possédés', async () => {
    const m = await createMember(t);
    await buy(m, { itemCode: 'preset_debrouillard' });
    const res = await t.app.inject({ method: 'GET', url: '/v1/me/export', headers: m.headers });
    expect(res.json().sections.items).toEqual([
      expect.objectContaining({ code: 'preset_debrouillard', kind: 'avatar_preset', source: 'purchase', serial: null }),
    ]);
  });
});
