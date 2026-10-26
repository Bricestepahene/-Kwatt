/**
 * Salons et défis (écrans 02, 24, 25, 26), de bout en bout avec une vraie base : aperçu par
 * code, places, prêts, lancement, aller-retour, roi de la table, hôte parti, place gardée,
 * fermeture, invitations ; défis avec mise, contre-proposition, refus, expiration.
 */
import type { ChallengeView, RoomPreview, RoomView, StakeCapView } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { balanceOf } from '../economy/ledger.js';
import { buildTestApp, connectWs, createGuest, createMember, testDevice, type TestApp, type TestMember, type TestUser } from '../../test/helpers.js';
import { pairOf } from '../friends/relations.js';
import { ROOM_IDLE_MS, SEAT_KEPT_MS } from './service.js';

vi.setConfig({ testTimeout: 30_000 });

let t: TestApp;

beforeAll(async () => {
  t = await buildTestApp({ suite: 'rooms', listen: true });
});
afterAll(async () => {
  await t.close();
});

async function call<T>(user: TestUser | null, method: 'GET' | 'POST', url: string, payload?: unknown, status = 200): Promise<T> {
  const res = await t.app.inject({ method, url, headers: user?.headers ?? {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
  expect(res.statusCode, res.body).toBe(status);
  return res.json<T>();
}

async function errorOf(user: TestUser | null, method: 'GET' | 'POST', url: string, payload?: unknown): Promise<{ status: number; code: string }> {
  const res = await t.app.inject({ method, url, headers: user?.headers ?? {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, code: res.json<{ error: { code: string } }>().error.code };
}

async function befriend(a: TestUser, b: TestUser): Promise<void> {
  const [x, y] = pairOf(a.userId, b.userId);
  await t.app.db.query(`INSERT INTO friendships (user_a, user_b, requested_by, status, accepted_at) VALUES ($1, $2, $1, 'accepted', now())`, [x, y]);
}

const damesRoom = (extra: Record<string, unknown> = {}) => ({ game: 'dames', variant: 'dames10', name: 'Table du quartier', seats: 2, format: 'simple', stake: 0, ...extra });

/** Termine la partie en cours du salon : `loser` abandonne. */
async function finish(gameId: string, loserId: string): Promise<void> {
  const actor = await t.app.games.require(gameId);
  await actor.resign(loserId);
  await t.app.games.settled(gameId);
}

describe('Salons', () => {
  let host: TestMember;
  let b: TestMember;
  let c: TestMember;
  let guest: TestUser;
  beforeAll(async () => {
    host = await createMember(t, { verified: true });
    b = await createMember(t, { verified: true, locale: 'en' });
    c = await createMember(t, { verified: true });
    guest = await createGuest(t);
  });

  it('créer, aperçu par code sans jeton, s\'asseoir, prêt, lancer ; la vue arrive en temps réel', async () => {
    const room = await call<RoomView>(host, 'POST', '/v1/rooms', damesRoom(), 201);
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(room.me).toMatchObject({ role: 'seat', seat: 0, isHost: true, ready: true });
    expect(room.clock).toEqual({ initialMs: 300_000, incrementMs: 3_000 });

    // Écran 02 : « abc-def » en minuscules, sans session.
    const dashed = `${room.code.slice(0, 3)}-${room.code.slice(3).toLowerCase()}`;
    const preview = await call<RoomPreview>(null, 'GET', `/v1/rooms/by-code/${dashed}`);
    expect(preview).toMatchObject({ code: room.code, name: 'Table du quartier', seats: 2, status: 'open' });
    expect(preview.seated.map((p) => p.userId)).toEqual([host.userId]);
    expect(await errorOf(null, 'GET', '/v1/rooms/by-code/AAAAA0')).toEqual({ status: 404, code: 'room.not_found' });

    const ws = await connectWs(t, host);
    ws.send({ t: 'room.subscribe', id: 'r1', code: room.code });
    expect((await ws.next('room.state')).room).toMatchObject({ code: room.code });

    // Un invité s'assoit ; l'hôte ne lance pas tant qu'il n'est pas prêt.
    const joined = await call<RoomView>(guest, 'POST', `/v1/rooms/${room.code}/join`, { as: 'seat' });
    expect(joined.me).toMatchObject({ role: 'seat', seat: 1, ready: false, isHost: false });
    const pushed = await ws.next((m) => m.t === 'room.state' && (m.room as RoomView).table[1]?.player?.userId === guest.userId);
    expect((pushed.room as RoomView).table[1]?.player).toMatchObject({ guest: true });
    expect(await errorOf(host, 'POST', `/v1/rooms/${room.code}/start`)).toEqual({ status: 409, code: 'room.not_ready' });
    expect(await errorOf(guest, 'POST', `/v1/rooms/${room.code}/start`)).toEqual({ status: 403, code: 'room.not_host' });
    await call(guest, 'POST', `/v1/rooms/${room.code}/ready`, { ready: true });
    const started = await call<RoomView>(host, 'POST', `/v1/rooms/${room.code}/start`);
    expect(started.status).toBe('playing');
    expect(started.gameId).toBeTruthy();

    // Partie lancée : un nouveau venu passe dans la file.
    const queued = await call<RoomView>(c, 'POST', `/v1/rooms/${room.code}/join`, { as: 'seat' });
    expect(queued.me).toMatchObject({ role: 'queue' });
    expect(queued.queue[0]).toMatchObject({ userId: c.userId, position: 1 });

    // Fin de partie : le salon rouvre, prêts remis à zéro, dernière partie gardée.
    await finish(started.gameId!, guest.userId);
    const after = await call<RoomView>(host, 'GET', `/v1/rooms/${room.code}`);
    expect(after).toMatchObject({ status: 'open', gameId: null, lastGameId: started.gameId });
    expect(after.table[1]?.ready).toBe(false);
    await ws.close();
  });

  it('aller-retour : la deuxième manche échange les couleurs', async () => {
    const room = await call<RoomView>(host, 'POST', '/v1/rooms', damesRoom({ format: 'aller_retour' }), 201);
    await call(b, 'POST', `/v1/rooms/${room.code}/join`, {});
    await call(b, 'POST', `/v1/rooms/${room.code}/ready`, { ready: true });
    const leg1 = await call<RoomView>(host, 'POST', `/v1/rooms/${room.code}/start`);
    expect(leg1.leg).toBe(1);
    expect((await t.app.games.require(leg1.gameId!)).config.seats.map((s) => s.userId)).toEqual([host.userId, b.userId]);
    await finish(leg1.gameId!, b.userId);

    await call(b, 'POST', `/v1/rooms/${room.code}/ready`, { ready: true });
    const leg2 = await call<RoomView>(host, 'POST', `/v1/rooms/${room.code}/start`);
    expect(leg2.leg).toBe(2);
    expect((await t.app.games.require(leg2.gameId!)).config.seats.map((s) => s.userId)).toEqual([b.userId, host.userId]);
    await finish(leg2.gameId!, host.userId);
    expect((await call<RoomView>(host, 'GET', `/v1/rooms/${room.code}`)).leg).toBe(1);
  });

  it('roi de la table : le gagnant garde sa place, le perdant passe derrière la file', async () => {
    const room = await call<RoomView>(host, 'POST', '/v1/rooms', damesRoom({ format: 'roi' }), 201);
    await call(b, 'POST', `/v1/rooms/${room.code}/join`, {});
    // Table pleine : « Rejoindre » place dans la file.
    await call(c, 'POST', `/v1/rooms/${room.code}/join`, {});
    const before = await call<RoomView>(c, 'GET', `/v1/rooms/${room.code}`);
    expect(before.me.role).toBe('queue');
    await call(b, 'POST', `/v1/rooms/${room.code}/ready`, { ready: true });
    const g1 = await call<RoomView>(host, 'POST', `/v1/rooms/${room.code}/start`);
    await finish(g1.gameId!, host.userId);

    const after = await call<RoomView>(c, 'GET', `/v1/rooms/${room.code}`);
    expect(after.king).toMatchObject({ userId: b.userId, wins: 1 });
    expect(after.me).toMatchObject({ role: 'seat' });
    expect(after.queue.map((p) => p.userId)).toEqual([host.userId]);
    expect(after.table.find((s) => s.player?.userId === b.userId)).toBeTruthy();

    // Le roi gagne encore : deux victoires d'affilée.
    await call(c, 'POST', `/v1/rooms/${room.code}/ready`, { ready: true });
    await call(b, 'POST', `/v1/rooms/${room.code}/ready`, { ready: true });
    // L'hôte est dans la file : il lance quand même (il reste hôte du salon).
    const g2 = await call<RoomView>(host, 'POST', `/v1/rooms/${room.code}/start`);
    await finish(g2.gameId!, c.userId);
    expect((await call<RoomView>(b, 'GET', `/v1/rooms/${room.code}`)).king).toMatchObject({ userId: b.userId, wins: 2 });
  });

  it('hôte parti : le plus ancien devient hôte ; dernier parti : salon fermé', async () => {
    const room = await call<RoomView>(host, 'POST', '/v1/rooms', damesRoom(), 201);
    await call(b, 'POST', `/v1/rooms/${room.code}/join`, {});
    await call(c, 'POST', `/v1/rooms/${room.code}/join`, { as: 'spectator' });
    await call(host, 'POST', `/v1/rooms/${room.code}/leave`);
    const v = await call<RoomView>(b, 'GET', `/v1/rooms/${room.code}`);
    expect(v.host.userId).toBe(b.userId);
    expect(v.me.isHost).toBe(true);
    expect(v.spectators).toBe(1);
    await call(b, 'POST', `/v1/rooms/${room.code}/leave`);
    await call(c, 'POST', `/v1/rooms/${room.code}/leave`);
    expect(await errorOf(null, 'GET', `/v1/rooms/by-code/${room.code}`)).toEqual({ status: 410, code: 'room.closed' });
    expect(await errorOf(b, 'POST', `/v1/rooms/${room.code}/join`, {})).toEqual({ status: 410, code: 'room.closed' });
  });

  it('place gardée 60 s après une coupure, puis libérée ; salon fermé après 30 min sans partie', async () => {
    const room = await call<RoomView>(host, 'POST', '/v1/rooms', damesRoom(), 201);
    const wb = await connectWs(t, b);
    await call(b, 'POST', `/v1/rooms/${room.code}/join`, {});
    await wb.close();
    await vi.waitFor(async () => {
      const v = await call<RoomView>(host, 'GET', `/v1/rooms/${room.code}`);
      expect(v.table[1]?.keptUntil).toBeTruthy();
    });
    await t.app.rooms.tick();
    expect((await call<RoomView>(host, 'GET', `/v1/rooms/${room.code}`)).table[1]?.player?.userId).toBe(b.userId);
    t.clock.advance(SEAT_KEPT_MS + 1);
    await t.app.rooms.tick();
    expect((await call<RoomView>(host, 'GET', `/v1/rooms/${room.code}`)).table[1]?.player).toBeNull();

    // Les jetons d'accès expirent : on remet l'horloge après la tâche.
    const back = t.clock.now();
    t.clock.advance(ROOM_IDLE_MS);
    await t.app.rooms.tick();
    t.clock.set(back);
    expect((await call<RoomView>(host, 'GET', `/v1/rooms/${room.code}`)).status).toBe('closed');
  });

  it('réglages refusés ; invitations aux amis seulement', async () => {
    expect(await errorOf(guest, 'POST', '/v1/rooms', damesRoom())).toMatchObject({ status: 403 });
    expect(await errorOf(host, 'POST', '/v1/rooms', damesRoom({ seats: 4 }))).toEqual({ status: 400, code: 'room.invalid_settings' });
    expect(await errorOf(host, 'POST', '/v1/rooms', damesRoom({ clock: { initialMs: 1000, incrementMs: 0 } }))).toEqual({ status: 400, code: 'room.invalid_settings' });
    expect(await errorOf(host, 'POST', '/v1/rooms', { ...damesRoom(), game: 'ludo', variant: 'ludo_parchis', seats: 4, stake: 10 })).toEqual({
      status: 400,
      code: 'room.invalid_settings',
    });

    const room = await call<RoomView>(host, 'POST', '/v1/rooms', damesRoom(), 201);
    expect(await errorOf(host, 'POST', `/v1/rooms/${room.code}/invite`, { userId: c.userId })).toEqual({ status: 403, code: 'room.invite_refused' });
    await befriend(host, c);
    await call(host, 'POST', `/v1/rooms/${room.code}/invite`, { userId: c.userId });
    const n = await t.app.db.query<{ kind: string; params: { code: string } }>(`SELECT kind, params FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [c.userId]);
    expect(n.rows[0]).toMatchObject({ kind: 'invites.room', params: { code: room.code } });
    await call(host, 'POST', `/v1/rooms/${room.code}/leave`);
  });

  it('salons ouverts : un défi (salon privé) n\'y figure pas', async () => {
    const room = await call<RoomView>(host, 'POST', '/v1/rooms', damesRoom({ name: 'Salon public' }), 201);
    const open = await call<{ items: RoomPreview[] }>(b, 'GET', '/v1/rooms/open?game=dames');
    expect(open.items.some((r) => r.code === room.code)).toBe(true);
    await call(host, 'POST', `/v1/rooms/${room.code}/leave`);
  });
});

describe('Défis', () => {
  let a: TestMember;
  let b: TestMember;
  beforeAll(async () => {
    a = await createMember(t, { verified: true });
    b = await createMember(t, { verified: true, locale: 'en' });
  });

  it('défier un non-ami, soi-même ou un joueur bloqué : refusé', async () => {
    const req = { toUserId: b.userId, game: 'dames', variant: 'dames10', stake: 0, format: 'simple' };
    expect(await errorOf(a, 'POST', '/v1/challenges', req)).toEqual({ status: 403, code: 'challenge.not_friend' });
    expect(await errorOf(a, 'POST', '/v1/challenges', { ...req, toUserId: a.userId })).toEqual({ status: 400, code: 'challenge.self' });
    await befriend(a, b);
    await t.app.db.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [b.userId, a.userId]);
    expect(await errorOf(a, 'POST', '/v1/challenges', req)).toEqual({ status: 403, code: 'challenge.blocked' });
    await t.app.db.query('DELETE FROM blocks WHERE blocker_id = $1', [b.userId]);
  });

  it('mise : plafond, contre-proposition, acceptation → salon privé, mises bloquées, partie lancée', async () => {
    const cap = await call<StakeCapView>(a, 'GET', `/v1/challenges/cap?userId=${b.userId}&variant=dames10`);
    expect(cap.refusal).toBeNull();
    expect(cap.max).toBeGreaterThan(1);
    expect(await errorOf(a, 'POST', '/v1/challenges', { toUserId: b.userId, game: 'dames', variant: 'dames10', stake: cap.max + 1, format: 'simple' })).toMatchObject({
      code: 'stake.above_cap',
    });

    const stake = Math.min(cap.max, 20);
    const created = await call<ChallengeView>(a, 'POST', '/v1/challenges', { toUserId: b.userId, game: 'dames', variant: 'dames10', stake, format: 'simple' }, 201);
    expect(created).toMatchObject({ status: 'pending', awaiting: b.userId, stake, countered: false });
    const n = await t.app.db.query<{ kind: string }>(`SELECT kind FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [b.userId]);
    expect(n.rows[0]?.kind).toBe('invites.challenge');
    expect((await call<{ items: ChallengeView[] }>(b, 'GET', '/v1/challenges')).items.map((x) => x.id)).toContain(created.id);

    // L'auteur n'accepte pas son propre défi ; le défié contre-propose une mise plus basse.
    expect(await errorOf(a, 'POST', `/v1/challenges/${created.id}/accept`)).toEqual({ status: 403, code: 'challenge.not_yours' });
    const lower = Math.max(1, stake - 5);
    const countered = await call<ChallengeView>(b, 'POST', `/v1/challenges/${created.id}/counter`, { stake: lower });
    expect(countered).toMatchObject({ awaiting: a.userId, countered: true, stake: lower });

    const before = { a: await balanceOf(t.app.db, a.userId), b: await balanceOf(t.app.db, b.userId) };
    const accepted = await call<ChallengeView>(a, 'POST', `/v1/challenges/${created.id}/accept`);
    expect(accepted.status).toBe('accepted');
    expect(accepted.gameId).toBeTruthy();
    expect(accepted.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await balanceOf(t.app.db, a.userId)).toBe(before.a - lower);
    expect(await balanceOf(t.app.db, b.userId)).toBe(before.b - lower);
    const actor = await t.app.games.require(accepted.gameId!);
    expect(actor.config.seats.map((s) => s.userId)).toEqual([a.userId, b.userId]);
    expect(actor.config.listed).toBe(false);
    const open = await call<{ items: RoomPreview[] }>(b, 'GET', '/v1/rooms/open?game=dames');
    expect(open.items.some((r) => r.code === accepted.roomCode)).toBe(false);
    expect(await errorOf(b, 'POST', `/v1/challenges/${created.id}/decline`)).toEqual({ status: 409, code: 'challenge.closed' });

    await finish(accepted.gameId!, b.userId);
    expect(await balanceOf(t.app.db, a.userId)).toBe(before.a + lower);
  });

  it('refus, retrait et expiration après 2 h', async () => {
    const req = { toUserId: b.userId, game: 'ludo', variant: 'ludo_classique', stake: 0, format: 'simple' };
    const d = await call<ChallengeView>(a, 'POST', '/v1/challenges', req, 201);
    expect(await errorOf(a, 'POST', `/v1/challenges/${d.id}/decline`)).toEqual({ status: 403, code: 'challenge.not_yours' });
    expect((await call<ChallengeView>(b, 'POST', `/v1/challenges/${d.id}/decline`)).status).toBe('declined');

    const c = await call<ChallengeView>(a, 'POST', '/v1/challenges', req, 201);
    expect(await errorOf(b, 'POST', `/v1/challenges/${c.id}/cancel`)).toEqual({ status: 403, code: 'challenge.not_yours' });
    expect((await call<ChallengeView>(a, 'POST', `/v1/challenges/${c.id}/cancel`)).status).toBe('cancelled');

    const e = await call<ChallengeView>(a, 'POST', '/v1/challenges', req, 201);
    // Deux heures sans réponse (on recule l'échéance : les jetons d'accès expireraient).
    await t.app.db.query('UPDATE challenges SET expires_at = $2 WHERE id = $1', [e.id, new Date(t.clock.now().getTime() - 1)]);
    expect(await errorOf(b, 'POST', `/v1/challenges/${e.id}/accept`)).toEqual({ status: 409, code: 'challenge.closed' });
    expect((await call<ChallengeView>(b, 'GET', `/v1/challenges/${e.id}`)).status).toBe('expired');
  });

  it('revanche sans être amis ; jamais de mise entre deux comptes du même appareil', async () => {
    const device = testDevice();
    const x = await createMember(t, { verified: true, device });
    const y = await createMember(t, { verified: true, device });
    // Une partie amicale entre eux (sans mise) autorise la revanche.
    const room = await call<RoomView>(x, 'POST', '/v1/rooms', damesRoom(), 201);
    await call(y, 'POST', `/v1/rooms/${room.code}/join`, {});
    await call(y, 'POST', `/v1/rooms/${room.code}/ready`, { ready: true });
    const g = await call<RoomView>(x, 'POST', `/v1/rooms/${room.code}/start`);
    await finish(g.gameId!, y.userId);

    const cap = await call<StakeCapView>(y, 'GET', `/v1/challenges/cap?userId=${x.userId}&variant=dames10`);
    expect(cap).toMatchObject({ max: 0, refusal: 'stake.same_device' });
    const base = { toUserId: x.userId, game: 'dames', variant: 'dames10', format: 'simple', rematchOf: g.gameId };
    expect(await errorOf(y, 'POST', '/v1/challenges', { ...base, stake: 10 })).toEqual({ status: 403, code: 'stake.same_device' });
    expect((await call<ChallengeView>(y, 'POST', '/v1/challenges', { ...base, stake: 0 }, 201)).rematchOf).toBe(g.gameId);
  });
});
