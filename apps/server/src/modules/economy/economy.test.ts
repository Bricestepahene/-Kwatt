import { JournalResponseSchema, WELCOME_BONUS, WalletResponseSchema } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { buildTestApp, createGuest, createMember, type TestApp } from '../../test/helpers.js';
import { lockStake, lockStakes, payoutPot, refundStakes, gameEscrowKey } from './escrow.js';
import { balanceOf, escrowBalance, transfer } from './ledger.js';
import { grantWelcomeBonus } from './service.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'economy' });
});
afterAll(async () => {
  await t.close();
});

let keyCounter = 0;
const key = (prefix: string) => `${prefix}:${++keyCounter}:${Math.random().toString(36).slice(2)}`;

/** Crédite un joueur depuis le compte système « rewards ». */
async function credit(userId: string, amount: number): Promise<void> {
  await transfer(t.db.pool, {
    kind: 'admin_adjust',
    idempotencyKey: key('credit'),
    entries: [
      { wallet: { system: 'rewards' }, amount: -amount },
      { wallet: { userId }, amount },
    ],
  });
}

async function newGame(): Promise<string> {
  const r = await t.db.pool.query<{ id: string }>(
    `INSERT INTO games (context, variant, rules, rules_version, ranked, status)
     VALUES ('room', 'dames10', '{}', 'test', true, 'playing') RETURNING id`,
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('partie non créée');
  return id;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return 'ok';
}

/** Somme de tous les soldes : le grand livre en partie double la garde à zéro. */
async function totalOfAllWallets(): Promise<number> {
  const r = await t.db.pool.query<{ s: number }>('SELECT COALESCE(sum(balance), 0)::bigint AS s FROM wallets');
  return r.rows[0]?.s ?? NaN;
}

describe('grand livre', () => {
  it('refuse des écritures mal formées', async () => {
    const m = await createMember(t);
    const bad = (entries: Array<{ wallet: { userId: string } | { system: string }; amount: number }>, kind = 'admin_adjust') =>
      code(transfer(t.db.pool, { kind, idempotencyKey: key('bad'), entries }));
    expect(await bad([{ wallet: { system: 'rewards' }, amount: -5 }, { wallet: { userId: m.userId }, amount: 4 }])).toBe(
      'ledger.invalid_entries',
    );
    expect(await bad([{ wallet: { userId: m.userId }, amount: 0 }, { wallet: { system: 'rewards' }, amount: 0 }])).toBe(
      'ledger.invalid_entries',
    );
    expect(await bad([{ wallet: { system: 'rewards' }, amount: 0 }])).toBe('ledger.invalid_entries');
    expect(await bad([{ wallet: { userId: m.userId }, amount: 1.5 }, { wallet: { system: 'rewards' }, amount: -1.5 }])).toBe(
      'ledger.invalid_entries',
    );
    expect(await bad([{ wallet: { userId: m.userId }, amount: 5 }, { wallet: { userId: m.userId }, amount: -5 }])).toBe(
      'ledger.invalid_entries',
    );
    expect(await bad([{ wallet: { system: 'rewards' }, amount: -5 }, { wallet: { userId: m.userId }, amount: 5 }], 'Pas Bon')).toBe(
      'ledger.invalid_entries',
    );
  });

  it('écrit un mouvement équilibré et met les soldes à jour', async () => {
    const m = await createMember(t);
    const before = await totalOfAllWallets();
    const r = await transfer(t.db.pool, {
      kind: 'machine_win',
      idempotencyKey: key('win'),
      meta: { level: 'coriace' },
      entries: [
        { wallet: { system: 'rewards' }, amount: -40 },
        { wallet: { userId: m.userId }, amount: 40 },
      ],
    });
    expect(r.replayed).toBe(false);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS + 40);
    expect(r.entries.find((e) => e.amount === 40)?.balanceAfter).toBe(WELCOME_BONUS + 40);
    expect(await totalOfAllWallets()).toBe(before);
  });

  it('un joueur ne passe jamais sous zéro ; rien n\'est écrit en cas de refus', async () => {
    const m = await createMember(t);
    const k = key('debit');
    const err = await transfer(t.db.pool, {
      kind: 'purchase',
      idempotencyKey: k,
      entries: [
        { wallet: { userId: m.userId }, amount: -(WELCOME_BONUS + 1) },
        { wallet: { system: 'shop' }, amount: WELCOME_BONUS + 1 },
      ],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('wallet.insufficient_funds');
    expect((err as AppError).params).toEqual({ balance: WELCOME_BONUS, required: WELCOME_BONUS + 1 });
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS);
    const tx = await t.db.pool.query('SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1', [k]);
    expect(tx.rows).toHaveLength(0);
  });

  it('idempotence : la même clé ne compte qu\'une fois ; une autre nature est un conflit', async () => {
    const m = await createMember(t);
    const k = key('quest');
    const input = {
      kind: 'quest_reward',
      idempotencyKey: k,
      entries: [
        { wallet: { system: 'rewards' }, amount: -80 },
        { wallet: { userId: m.userId }, amount: 80 },
      ],
    };
    const first = await transfer(t.db.pool, input);
    const second = await transfer(t.db.pool, input);
    expect(second).toMatchObject({ txId: first.txId, replayed: true });
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS + 80);
    expect(await code(transfer(t.db.pool, { ...input, kind: 'daily_problem' }))).toBe('ledger.idempotency_conflict');
  });

  it('concurrence : des retraits simultanés ne font jamais passer le solde sous zéro', async () => {
    const m = await createMember(t);
    // 500 de bienvenue : 8 achats de 150 lancés en même temps, 3 seulement peuvent passer.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        transfer(t.db.pool, {
          kind: 'purchase',
          idempotencyKey: key('buy'),
          entries: [
            { wallet: { userId: m.userId }, amount: -150 },
            { wallet: { system: 'shop' }, amount: 150 },
          ],
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(3);
    for (const r of refused) expect(((r as PromiseRejectedResult).reason as AppError).code).toBe('wallet.insufficient_funds');
    expect(await balanceOf(t.db.pool, m.userId)).toBe(50);
    // Le journal retombe sur le solde, et chaque solde intermédiaire est resté positif.
    const j = await t.db.pool.query<{ s: number; min: number }>(
      `SELECT sum(e.amount)::bigint AS s, min(e.balance_after)::bigint AS min
         FROM ledger_entries e JOIN wallets w ON w.id = e.wallet_id WHERE w.user_id = $1`,
      [m.userId],
    );
    expect(j.rows[0]).toEqual({ s: 50, min: 50 });
  });

  it('concurrence : deux transferts croisés simultanés ne s\'interbloquent pas', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const move = (from: string, to: string) =>
      transfer(t.db.pool, {
        kind: 'admin_adjust',
        idempotencyKey: key('cross'),
        entries: [
          { wallet: { userId: from }, amount: -10 },
          { wallet: { userId: to }, amount: 10 },
        ],
      });
    await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? move(a.userId, b.userId) : move(b.userId, a.userId))));
    expect(await balanceOf(t.db.pool, a.userId)).toBe(WELCOME_BONUS);
    expect(await balanceOf(t.db.pool, b.userId)).toBe(WELCOME_BONUS);
  });

  it('concurrence : la même clé envoyée plusieurs fois en même temps n\'écrit qu\'un mouvement', async () => {
    const m = await createMember(t);
    const k = key('dup');
    const input = {
      kind: 'participation',
      idempotencyKey: k,
      entries: [
        { wallet: { system: 'rewards' }, amount: -10 },
        { wallet: { userId: m.userId }, amount: 10 },
      ],
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => transfer(t.db.pool, input)));
    expect(new Set(results.map((r) => r.txId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS + 10);
  });

  it('dans une transaction annulée, rien n\'est écrit', async () => {
    const m = await createMember(t);
    await expect(
      transaction(t.db.pool, async (tx) => {
        await transfer(tx, {
          kind: 'participation',
          idempotencyKey: key('rollback'),
          entries: [
            { wallet: { system: 'rewards' }, amount: -10 },
            { wallet: { userId: m.userId }, amount: 10 },
          ],
        });
        throw new Error('annulation');
      }),
    ).rejects.toThrow('annulation');
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS);
  });

  it('la base refuse un journal modifié ou une transaction déséquilibrée', async () => {
    const m = await createMember(t);
    await expect(t.db.pool.query('DELETE FROM ledger_entries')).rejects.toThrow(/ne se modifie pas/);
    await expect(t.db.pool.query("UPDATE ledger_transactions SET kind = 'x'")).rejects.toThrow(/ne se modifie pas/);
    const w = await t.db.pool.query<{ id: string }>('SELECT id FROM wallets WHERE user_id = $1', [m.userId]);
    await expect(
      transaction(t.db.pool, async (tx) => {
        const r = await tx.query<{ id: string }>(
          `INSERT INTO ledger_transactions (kind, idempotency_key) VALUES ('admin_adjust', $1) RETURNING id`,
          [key('raw')],
        );
        await tx.query('INSERT INTO ledger_entries (tx_id, wallet_id, amount, balance_after) VALUES ($1, $2, 5, 505)', [
          r.rows[0]?.id,
          w.rows[0]?.id,
        ]);
      }),
    ).rejects.toThrow(/non équilibrée/);
  });
});

describe('bonus de bienvenue', () => {
  it('+500 une seule fois par compte', async () => {
    const m = await createMember(t);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS);
    expect(await grantWelcomeBonus(t.db.pool, m.userId)).toBe(0);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS);
  });

  it('un invité n\'a pas de bonus ; il le reçoit à la création de son profil', async () => {
    const g = await createGuest(t);
    expect(await balanceOf(t.db.pool, g.userId)).toBe(0);
    await createMember(t, { fromGuest: g });
    expect(await balanceOf(t.db.pool, g.userId)).toBe(WELCOME_BONUS);
  });
});

describe('séquestre des mises', () => {
  it('bloque les mises, verse le pot au gagnant, une seule fois', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const gameId = await newGame();
    await lockStakes(t.db.pool, gameId, [
      { userId: a.userId, amount: 100 },
      { userId: b.userId, amount: 100 },
    ]);
    expect(await balanceOf(t.db.pool, a.userId)).toBe(400);
    expect(await escrowBalance(t.db.pool, gameEscrowKey(gameId))).toBe(200);
    // Bloquer deux fois la même mise ne débite pas deux fois.
    await lockStake(t.db.pool, gameId, { userId: a.userId, amount: 100 });
    expect(await balanceOf(t.db.pool, a.userId)).toBe(400);

    const payout = await payoutPot(t.db.pool, gameId, [a.userId], { reason: 'win' });
    expect(payout?.replayed).toBe(false);
    expect(await balanceOf(t.db.pool, a.userId)).toBe(600);
    expect(await balanceOf(t.db.pool, b.userId)).toBe(400);
    expect(await escrowBalance(t.db.pool, gameEscrowKey(gameId))).toBe(0);

    const again = await payoutPot(t.db.pool, gameId, [a.userId]);
    expect(again).toMatchObject({ txId: payout?.txId, replayed: true });
    expect(await balanceOf(t.db.pool, a.userId)).toBe(600);
  });

  it('tout ou rien : un solde insuffisant n\'en bloque aucune', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const gameId = await newGame();
    expect(
      await code(
        lockStakes(t.db.pool, gameId, [
          { userId: a.userId, amount: 100 },
          { userId: b.userId, amount: 600 },
        ]),
      ),
    ).toBe('wallet.insufficient_funds');
    expect(await balanceOf(t.db.pool, a.userId)).toBe(WELCOME_BONUS);
    expect(await escrowBalance(t.db.pool, gameEscrowKey(gameId))).toBe(0);
  });

  it('nul : chacun récupère sa mise ; un second remboursement ne fait rien', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const gameId = await newGame();
    await lockStakes(t.db.pool, gameId, [
      { userId: a.userId, amount: 50 },
      { userId: b.userId, amount: 70 },
    ]);
    const refund = await refundStakes(t.db.pool, gameId);
    expect(refund?.replayed).toBe(false);
    expect(await balanceOf(t.db.pool, a.userId)).toBe(WELCOME_BONUS);
    expect(await balanceOf(t.db.pool, b.userId)).toBe(WELCOME_BONUS);
    expect(await escrowBalance(t.db.pool, gameEscrowKey(gameId))).toBe(0);
    expect(await refundStakes(t.db.pool, gameId)).toBeNull();
  });

  it('rembourse un seul joueur (départ avant le début), puis le pot va au gagnant', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const c = await createMember(t);
    const gameId = await newGame();
    await lockStakes(t.db.pool, gameId, [
      { userId: a.userId, amount: 30 },
      { userId: b.userId, amount: 30 },
      { userId: c.userId, amount: 30 },
    ]);
    await refundStakes(t.db.pool, gameId, [c.userId]);
    expect(await balanceOf(t.db.pool, c.userId)).toBe(WELCOME_BONUS);
    expect(await escrowBalance(t.db.pool, gameEscrowKey(gameId))).toBe(60);
    await payoutPot(t.db.pool, gameId, [b.userId]);
    expect(await balanceOf(t.db.pool, b.userId)).toBe(WELCOME_BONUS + 30);
    expect(await balanceOf(t.db.pool, a.userId)).toBe(WELCOME_BONUS - 30);
  });

  it('pot partagé entre deux gagnants : le cauri restant va au premier', async () => {
    const players = await Promise.all([createMember(t), createMember(t), createMember(t)]);
    const gameId = await newGame();
    await lockStakes(
      t.db.pool,
      gameId,
      players.map((p) => ({ userId: p.userId, amount: 25 })),
    );
    const [first, second, third] = players;
    if (!first || !second || !third) throw new Error('joueurs manquants');
    await payoutPot(t.db.pool, gameId, [first.userId, second.userId]);
    expect(await balanceOf(t.db.pool, first.userId)).toBe(WELCOME_BONUS - 25 + 38);
    expect(await balanceOf(t.db.pool, second.userId)).toBe(WELCOME_BONUS - 25 + 37);
    expect(await balanceOf(t.db.pool, third.userId)).toBe(WELCOME_BONUS - 25);
  });

  it('concurrence : deux fins de partie simultanées ne versent le pot qu\'une fois', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const gameId = await newGame();
    await lockStakes(t.db.pool, gameId, [
      { userId: a.userId, amount: 100 },
      { userId: b.userId, amount: 100 },
    ]);
    await Promise.all([payoutPot(t.db.pool, gameId, [a.userId]), payoutPot(t.db.pool, gameId, [a.userId])]);
    expect(await balanceOf(t.db.pool, a.userId)).toBe(600);
    expect(await escrowBalance(t.db.pool, gameEscrowKey(gameId))).toBe(0);
  });
});

describe('routes du portefeuille', () => {
  it('GET /v1/wallet rend le solde', async () => {
    const m = await createMember(t);
    const res = await t.app.inject({ method: 'GET', url: '/v1/wallet', headers: m.headers });
    expect(res.statusCode).toBe(200);
    expect(WalletResponseSchema.parse(res.json())).toEqual({ balance: WELCOME_BONUS });
  });

  it('GET /v1/wallet/journal pagine du plus récent au plus ancien, sans trou ni doublon', async () => {
    const m = await createMember(t);
    // Plusieurs mouvements dans la même transaction (même milliseconde) : l'ordre doit tenir.
    await transaction(t.db.pool, async (tx) => {
      for (let i = 1; i <= 6; i++) {
        await transfer(tx, {
          kind: 'participation',
          idempotencyKey: key('journal'),
          meta: { n: i },
          entries: [
            { wallet: { system: 'rewards' }, amount: -i },
            { wallet: { userId: m.userId }, amount: i },
          ],
        });
      }
    });
    const seen: Array<{ kind: string; amount: number; balanceAfter: number }> = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/v1/wallet/journal?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await t.app.inject({ method: 'GET', url, headers: m.headers });
      expect(res.statusCode).toBe(200);
      const page = JournalResponseSchema.parse(res.json());
      seen.push(...page.items);
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen.map((e) => e.amount)).toEqual([6, 5, 4, 3, 2, 1, WELCOME_BONUS]);
    expect(seen.map((e) => e.balanceAfter)).toEqual([521, 515, 510, 506, 503, 501, WELCOME_BONUS]);
    expect(seen.at(-1)?.kind).toBe('welcome_bonus');
  });

  it('refuse un curseur illisible', async () => {
    const m = await createMember(t);
    const res = await t.app.inject({ method: 'GET', url: '/v1/wallet/journal?cursor=nimporte', headers: m.headers });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('common.validation');
  });

  it('exige d\'être connecté', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/wallet' });
    expect(res.statusCode).toBe(401);
  });
});
