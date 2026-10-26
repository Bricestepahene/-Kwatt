/**
 * Progression (écrans 36, 39, 40, 42), avec une vraie base : points et classement des
 * quartiers, clôture de saison (cadre et carte du champion), série de jours, quêtes de la
 * semaine (récupération idempotente par le grand livre), victoires marquantes, collection de
 * cartes et habillages, liste d'attente du Raisonnement.
 */
import type { CardCollection, ClaimResult, QuarterStandings, ReasoningWaitlist, RewardsView } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { transaction } from '../../db/pool.js';
import { balanceOf } from '../economy/ledger.js';
import { buildTestApp, createMember, type TestApp, type TestMember, type TestUser } from '../../test/helpers.js';

vi.setConfig({ testTimeout: 30_000 });

let t: TestApp;

beforeAll(async () => {
  t = await buildTestApp({ suite: 'progression' });
});
afterAll(async () => {
  await t.close();
});

async function call<T>(user: TestUser, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, status = 200): Promise<T> {
  const res = await t.app.inject({ method, url, headers: user.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}

async function errorOf(user: TestUser, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown): Promise<{ status: number; code: string }> {
  const res = await t.app.inject({ method, url, headers: user.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, code: res.json<{ error: { code: string } }>().error.code };
}

/** Partie classée entre joueurs : `winner` gagne (les autres abandonnent). */
async function play(winner: TestMember, others: TestMember[], variant = 'dames10'): Promise<string> {
  const seats = [winner, ...others].map((u) => ({ userId: u.userId, name: u.pseudo, staking: false, guest: false }));
  const cfg = await transaction(t.app.db, (tx) =>
    t.app.games.createGame(tx, { context: 'room', variant, seats, ranked: true, stake: 0, clock: null, turnMs: null }),
  );
  const actor = await t.app.games.require(cfg.id);
  for (const o of others) if (actor.status === 'playing') await actor.resign(o.userId);
  await t.app.games.settled(cfg.id);
  return cfg.id;
}

/** Nouveau jeton d'accès après un saut d'horloge (le jeton d'accès expire vite). */
async function relogin(u: TestMember): Promise<void> {
  const res = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: u.refreshToken, device: u.device } });
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json<{ accessToken: string; refreshToken: string }>();
  u.accessToken = body.accessToken;
  u.refreshToken = body.refreshToken;
  u.headers = { authorization: `Bearer ${body.accessToken}` };
}

async function setQuarter(u: TestMember, quarter: string): Promise<void> {
  await t.app.db.query('UPDATE profiles SET quarter = $2 WHERE user_id = $1', [u.userId, quarter]);
}

async function setRating(u: TestMember, variant: string, rating: number): Promise<void> {
  await t.app.db.query(
    'INSERT INTO player_ratings (user_id, variant, rating) VALUES ($1, $2, $3) ON CONFLICT (user_id, variant) DO UPDATE SET rating = $3',
    [u.userId, variant, rating],
  );
}

describe('Guerre des quartiers', () => {
  it('points au quartier du gagnant, classement, saison close avec champion', async () => {
    t.clock.set(new Date('2026-09-10T10:00:00Z'));
    const akwa = await createMember(t);
    const bali = await createMember(t);
    await setQuarter(akwa, 'cm-douala-akwa');
    await setQuarter(bali, 'cm-douala-bali');
    await setRating(akwa, 'dames10', 1000);
    await setRating(bali, 'dames10', 1200);
    // Victoire contre plus fort (+5) d'un quartier rival (+2).
    await play(akwa, [bali]);
    const pts = await t.app.db.query<{ points: number; season: string }>('SELECT points, season FROM quarter_points WHERE user_id = $1', [akwa.userId]);
    expect(pts.rows).toEqual([{ points: 7, season: '2026-09' }]);

    const q = await call<QuarterStandings>(akwa, 'GET', '/v1/quarters/standings?scope=quarter');
    expect(q).toMatchObject({ season: '2026-09', scope: 'quarter', myPoints: 7, area: { city: 'Douala', country: 'CM' } });
    expect(q.items[0]).toMatchObject({ key: 'cm-douala-akwa', points: 7, position: 1 });
    expect(q.mine).toMatchObject({ key: 'cm-douala-akwa', position: 1 });
    const c = await call<QuarterStandings>(akwa, 'GET', '/v1/quarters/standings?scope=city');
    expect(c.items.find((x) => x.key === 'CM:Douala')).toMatchObject({ points: 7, city: 'Douala' });
    const p = await call<QuarterStandings>(akwa, 'GET', '/v1/quarters/standings?scope=country');
    expect(p.mine).toMatchObject({ key: 'CM', points: expect.any(Number) });

    // Saison suivante : clôture, le quartier champion reçoit cadre et carte.
    t.clock.set(new Date('2026-10-01T10:00:00Z'));
    await t.app.jobs.runNow('quarters.close_season');
    await relogin(akwa);
    const owned = await t.app.db.query<{ code: string }>(
      `SELECT i.code FROM owned_items o JOIN items i ON i.id = o.item_id WHERE o.user_id = $1 ORDER BY i.code`,
      [akwa.userId],
    );
    expect(owned.rows.map((x) => x.code)).toEqual(expect.arrayContaining(['card_trophee_quartier', 'frame_quartier_champion']));
    const next = await call<QuarterStandings>(akwa, 'GET', '/v1/quarters/standings');
    expect(next).toMatchObject({ season: '2026-10', seasonNumber: 2, myPoints: 0, lastChampion: { key: 'cm-douala-akwa' } });
  });
});

describe('Récompenses', () => {
  it('série de jours : carte rare au choix au 7e jour', async () => {
    t.clock.set(new Date(Date.UTC(2026, 10, 2, 8)));
    const me = await createMember(t);
    const other = await createMember(t);
    for (let d = 0; d < 7; d++) {
      t.clock.set(new Date(Date.UTC(2026, 10, 2 + d, 12)));
      await play(me, [other]);
    }
    await relogin(me);
    const view = await call<RewardsView>(me, 'GET', '/v1/rewards');
    expect(view.streak).toMatchObject({ length: 7, best: 7, today: true, rareChoices: 1, daysToReward: 7 });
    expect(view.streak.choices.length).toBeGreaterThan(0);
    const pick = view.streak.choices[0]!;
    const res = await call<ClaimResult>(me, 'POST', '/v1/rewards/streak/choose', { code: pick });
    expect(res.card).toBe(pick);
    expect(res.rewards.streak.rareChoices).toBe(0);
    expect(await errorOf(me, 'POST', '/v1/rewards/streak/choose', { code: pick })).toEqual({ status: 409, code: 'rewards.no_choice' });
    // Un jour sans partie : la série retombe.
    t.clock.set(new Date(Date.UTC(2026, 10, 10, 12)));
    await relogin(me);
    expect((await call<RewardsView>(me, 'GET', '/v1/rewards')).streak.length).toBe(0);
  });

  it('quête « 3 parties de Ludo » : récupérée une fois, par le grand livre', async () => {
    t.clock.set(new Date('2026-11-16T09:00:00Z'));
    const me = await createMember(t);
    const a = await createMember(t);
    const view0 = await call<RewardsView>(me, 'GET', '/v1/rewards');
    expect(view0.week).toBe('2026-W47');
    expect(view0.quests.map((q) => q.id)).toEqual(['win_3_ludo', 'win_two_leg', 'rafle_3']);
    expect(await errorOf(me, 'POST', '/v1/rewards/quests/win_3_ludo/claim')).toEqual({ status: 409, code: 'rewards.quest_not_done' });
    for (let i = 0; i < 3; i++) await play(me, [a], 'ludo_classique');
    const done = await call<RewardsView>(me, 'GET', '/v1/rewards');
    expect(done.quests[0]).toMatchObject({ id: 'win_3_ludo', progress: 3, done: true, claimed: false });
    const n = await t.app.db.query("SELECT params FROM notifications WHERE user_id = $1 AND kind = 'quest.completed'", [me.userId]);
    expect(n.rows).toEqual([{ params: { questId: 'win_3_ludo', amount: 50 } }]);

    const before = await balanceOf(t.app.db, me.userId);
    const res = await call<ClaimResult>(me, 'POST', '/v1/rewards/quests/win_3_ludo/claim');
    expect(res.cauris).toBe(50);
    expect(await balanceOf(t.app.db, me.userId)).toBe(before + 50);
    expect(await errorOf(me, 'POST', '/v1/rewards/quests/win_3_ludo/claim')).toEqual({ status: 409, code: 'rewards.already_claimed' });
    expect(await errorOf(me, 'POST', '/v1/rewards/quests/inconnue/claim')).toEqual({ status: 404, code: 'rewards.quest_not_found' });
  });

  it('victoire marquante contre bien plus fort : sa carte', async () => {
    const me = await createMember(t);
    const strong = await createMember(t);
    await setRating(me, 'dames10', 1000);
    await setRating(strong, 'dames10', 1300);
    await play(me, [strong]);
    const cards = await call<CardCollection>(me, 'GET', '/v1/cards');
    expect(cards.items.find((c) => c.code === 'card_damier_toghu')).toMatchObject({ owned: true, how: 'feat', feat: 'upset_dames' });
    expect(cards.items.find((c) => c.code === 'card_pouvoir_revoir_annote')?.owned).toBe(true);
  });
});

describe('Cartes', () => {
  it('48 cartes, cartes de départ et d’échelon, habillages équipés', async () => {
    const me = await createMember(t);
    const col = await call<CardCollection>(me, 'GET', '/v1/cards');
    expect(col.total).toBe(48);
    expect(col.items.filter((c) => c.owned).map((c) => c.code).sort()).toEqual(['card_damier_bois', 'card_ludo_classique', 'card_table_village']);
    expect(col.items.find((c) => c.code === 'card_table_wouri')).toMatchObject({ owned: false, how: 'rank', rank: 'notable', limit: 500 });
    expect(col.items.find((c) => c.code === 'card_de_or')).toMatchObject({ edition: { total: 500, given: 0 } });

    // Échelon Notable (niveau 15 → force 1 400) : les tables jusqu'au Wouri.
    await setRating(me, 'dames10', 1410);
    const after = await call<CardCollection>(me, 'GET', '/v1/cards');
    expect(after.items.find((c) => c.code === 'card_table_wouri')?.owned).toBe(true);
    expect(after.items.find((c) => c.code === 'card_table_mont_cameroun')?.owned).toBe(false);

    const eq = await call<CardCollection>(me, 'PUT', '/v1/cards/equipped', { slot: 'board', code: 'card_damier_bois' });
    expect(eq.equipped).toEqual({ board: 'card_damier_bois', pieces: null, dice: null });
    expect(eq.items.find((c) => c.code === 'card_damier_bois')?.equipped).toBe(true);
    expect(await errorOf(me, 'PUT', '/v1/cards/equipped', { slot: 'board', code: 'card_damier_ndop' })).toEqual({ status: 403, code: 'cards.not_owned' });
    expect(await errorOf(me, 'PUT', '/v1/cards/equipped', { slot: 'dice', code: 'card_damier_bois' })).toEqual({ status: 404, code: 'cards.not_found' });
    expect((await call<CardCollection>(me, 'PUT', '/v1/cards/equipped', { slot: 'board', code: null })).equipped.board).toBeNull();
  });
});

describe('Raisonnement', () => {
  it('liste d’attente', async () => {
    const me = await createMember(t);
    expect((await call<ReasoningWaitlist>(me, 'GET', '/v1/reasoning/waitlist')).joined).toBe(false);
    const joined = await call<ReasoningWaitlist>(me, 'POST', '/v1/reasoning/waitlist');
    expect(joined.joined).toBe(true);
    expect(joined.count).toBeGreaterThanOrEqual(1);
    expect((await call<ReasoningWaitlist>(me, 'DELETE', '/v1/reasoning/waitlist')).joined).toBe(false);
  });
});
