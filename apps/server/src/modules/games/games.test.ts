/**
 * Parties en ligne (contrat C3), de bout en bout avec une vraie base : deux clients WebSocket
 * jouent une partie de Dames et une de Ludo avec mise, pendule, absence, nulle, machine en
 * ligne avec pari, reprise après redémarrage, dé vérifiable, spectateurs et pronostics.
 */
import { verifyGame } from '@kwatt/fair-dice';
import { legalMoves, toNotation, type DamesState } from '@kwatt/rules-dames';
import { distinctMoves, legalMoves as ludoLegal, tokenNotation, type LudoState } from '@kwatt/rules-ludo';
import type { DiceProof, GameSummary, PredictionsView } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
import { buildApp } from '../../app.js';
import { transaction } from '../../db/pool.js';
import { MemoryTransport } from '../../lib/mailer.js';
import { MemoryPushSender } from '../notifications/push.js';
import { balanceOf } from '../economy/ledger.js';
import { buildTestApp, connectWs, createGuest, createMember, type TestApp, type TestMember, type TestUser } from '../../test/helpers.js';
import type { TestWsClient } from '../../test/ws-client.js';
import type { GameActor } from './actor.js';
import type { CreateGameInput, GameFinishedEvent } from './service.js';

let t: TestApp;
const finished: GameFinishedEvent[] = [];

beforeAll(async () => {
  t = await buildTestApp({ suite: 'games', listen: true });
  t.app.games.onGameFinished((e) => {
    finished.push(e);
  });
});
afterAll(async () => {
  await t.close();
});

const seat = (u: TestUser & { pseudo?: string }, staking = false) => ({ userId: u.userId, name: u.pseudo ?? 'invité', staking, guest: !('pseudo' in u) });

async function create(input: Partial<CreateGameInput> & Pick<CreateGameInput, 'variant' | 'seats'>): Promise<GameActor> {
  const cfg = await transaction(t.app.db, (tx) =>
    t.app.games.createGame(tx, {
      context: 'room',
      ranked: true,
      stake: 0,
      clock: null,
      turnMs: null,
      ...input,
    }),
  );
  const actor = await t.app.games.get(cfg.id);
  return actor!;
}

function firstDamesMove(actor: GameActor): string {
  return toNotation(legalMoves(actor.rules.state as DamesState)[0]!);
}

async function summary(gameId: string, user: TestUser): Promise<GameSummary> {
  const res = await t.app.inject({ method: 'GET', url: `/v1/games/${gameId}`, headers: user.headers });
  expect(res.statusCode).toBe(200);
  return res.json<GameSummary>();
}

/** Attend qu'une condition devienne vraie (présence, file de la partie). */
async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('condition jamais remplie');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function goOffline(ws: TestWsClient, userId: string, actor: GameActor): Promise<void> {
  await ws.close();
  await waitFor(() => !t.app.realtime.isOnline(userId));
  await new Promise((r) => setTimeout(r, 20));
  await t.app.games.settled(actor.id);
}


describe('Dames en ligne', () => {
  let a: TestMember;
  let b: TestMember;
  beforeAll(async () => {
    a = await createMember(t, { verified: true, locale: 'fr' });
    b = await createMember(t, { verified: true, locale: 'en' });
  });

  it('deux clients WS jouent ; mise de 50 bloquée puis versée au gagnant ; même état dans les deux langues', async () => {
    const before = { a: await balanceOf(t.app.db, a.userId), b: await balanceOf(t.app.db, b.userId) };
    const wa = await connectWs(t, a);
    const wb = await connectWs(t, b);
    const actor = await create({ variant: 'dames10', seats: [seat(a, true), seat(b, true)], stake: 50, clock: { initialMs: 300_000, incrementMs: 3_000 } });
    expect(await balanceOf(t.app.db, a.userId)).toBe(before.a - 50);

    wa.send({ t: 'game.subscribe', id: 's1', gameId: actor.id });
    wb.send({ t: 'game.subscribe', id: 's2', gameId: actor.id });
    const sa = await wa.next('game.state');
    const sb = await wb.next('game.state');
    expect(sa.mySeats).toEqual([0]);
    expect(sb.mySeats).toEqual([1]);
    expect({ ...sa, mySeats: null, re: null, serverTime: 0 }).toEqual({ ...sb, mySeats: null, re: null, serverTime: 0 });

    // Les noirs ne jouent pas au tour des blancs : un code, jamais une phrase.
    wb.send({ t: 'game.move', id: 'm0', gameId: actor.id, seq: 0, move: '32-28' });
    const err = await wb.next('error');
    expect(err).toMatchObject({ re: 'm0', code: 'game.not_your_turn' });

    // Coup illégal, puis numéro d'état dépassé.
    wa.send({ t: 'game.move', id: 'm1', gameId: actor.id, seq: 0, move: '1-50' });
    expect(await wa.next('error')).toMatchObject({ re: 'm1', code: 'game.illegal_move' });

    for (let i = 0; i < 6; i++) {
      const who = actor.rules.turnSeat() === 0 ? wa : wb;
      who.send({ t: 'game.move', id: `p${i}`, gameId: actor.id, seq: actor.seq, move: firstDamesMove(actor) });
      await who.next((m) => m.t === 'game.ack' && m.re === `p${i}`);
    }
    await waitFor(() => wb.messages.some((m) => m.t === 'game.state' && m.seq === actor.seq));
    const sync = [...wb.messages].reverse().find((m) => m.t === 'game.state')!;
    expect((sync.moves as string[]).length).toBe(6);
    expect(sync.clocks).toMatchObject({ '0': { running: true }, '1': { running: false } });
    wb.send({ t: 'game.move', id: 'old', gameId: actor.id, seq: 1, move: firstDamesMove(actor) });

    // Les blancs abandonnent : le pot (100) va aux noirs.
    wa.send({ t: 'game.resign', id: 'r', gameId: actor.id });
    const end = await wb.next('game.end');
    expect(end.outcome).toMatchObject({ places: { '0': 2, '1': 1 }, draw: false, reason: 'resign' });
    await t.app.games.settled(actor.id);
    expect(await balanceOf(t.app.db, a.userId)).toBe(before.a - 50);
    expect(await balanceOf(t.app.db, b.userId)).toBe(before.b + 50);

    const s = await summary(actor.id, a);
    expect(s).toMatchObject({ status: 'finished', context: 'room', stake: 50, pot: 100, outcome: { reason: 'resign' } });
    expect(s.moves).toHaveLength(6);
    expect(Object.keys(s.ratingChanges).sort()).toEqual([a.userId, b.userId].sort());
    expect(finished.find((e) => e.gameId === actor.id)).toMatchObject({ context: 'room', outcome: { places: { '0': 2, '1': 1 } } });
    await wa.close();
    await wb.close();
  });

  it('pendule Fischer : temps écoulé → défaite au temps', async () => {
    const wa = await connectWs(t, a);
    const wb = await connectWs(t, b);
    const actor = await create({ variant: 'dames8', seats: [seat(a), seat(b)], clock: { initialMs: 180_000, incrementMs: 2_000 } });
    // En 8×8, les noirs commencent.
    expect(actor.rules.turnSeat()).toBe(1);
    await actor.move(b.userId, actor.seq, firstDamesMove(actor));
    const clocks = actor.clocks()!;
    expect(clocks['1']!.remainingMs).toBe(182_000);
    t.clock.advance(180_001);
    await t.app.games.tick();
    expect(actor.outcome).toMatchObject({ reason: 'timeout', places: { 0: 2, 1: 1 } });
    await wa.close();
    await wb.close();
  });

  it('coupure : pendules arrêtées, 60 s pour revenir, puis défaite par absence', async () => {
    const wa = await connectWs(t, a);
    const wb = await connectWs(t, b);
    const actor = await create({ variant: 'dames10', seats: [seat(a), seat(b)], clock: { initialMs: 300_000, incrementMs: 3_000 } });
    await goOffline(wb, b.userId, actor);
    t.clock.advance(30_000);
    await t.app.games.tick();
    expect(actor.status).toBe('playing');
    // Pendules arrêtées pendant la coupure : les blancs n'ont rien perdu.
    expect(actor.clocks()!['0']).toMatchObject({ remainingMs: 300_000, running: false });
    // Retour avant 60 s : la partie continue.
    const wb2 = await connectWs(t, b);
    await waitFor(() => actor.stateFor(null).seats[1]!.connected);
    await new Promise((r) => setTimeout(r, 20));
    await t.app.games.settled(actor.id);
    t.clock.advance(50_000);
    await t.app.games.tick();
    expect(actor.status).toBe('playing');
    await goOffline(wb2, b.userId, actor);
    t.clock.advance(61_000);
    await t.app.games.tick();
    expect(actor.outcome).toMatchObject({ reason: 'absence', places: { 0: 1, 1: 2 } });
    await wa.close();
  });

  it('proposer la nulle : une fois tous les 10 coups ; nulle acceptée → mises rendues', async () => {
    const wa = await connectWs(t, a);
    const wb = await connectWs(t, b);
    const before = { a: await balanceOf(t.app.db, a.userId), b: await balanceOf(t.app.db, b.userId) };
    const actor = await create({ variant: 'dames10', seats: [seat(a, true), seat(b, true)], stake: 20, clock: { initialMs: 300_000, incrementMs: 3_000 } });
    await actor.offerDraw(a.userId);
    await actor.answerDraw(b.userId, false);
    await expect(actor.offerDraw(a.userId)).rejects.toMatchObject({ code: 'game.draw_too_soon' });
    await expect(actor.answerDraw(b.userId, true)).rejects.toMatchObject({ code: 'game.no_draw_offer' });
    await actor.offerDraw(b.userId);
    await actor.answerDraw(a.userId, true);
    expect(actor.outcome).toMatchObject({ draw: true, reason: 'agreement' });
    await t.app.games.settled(actor.id);
    expect(await balanceOf(t.app.db, a.userId)).toBe(before.a);
    expect(await balanceOf(t.app.db, b.userId)).toBe(before.b);
    await wa.close();
    await wb.close();
  });

  it('reprise après redémarrage du serveur : la partie est rejouée depuis la base', async () => {
    const wa = await connectWs(t, a);
    const wb = await connectWs(t, b);
    const actor = await create({ variant: 'dames10', seats: [seat(a), seat(b)], clock: { initialMs: 300_000, incrementMs: 3_000 } });
    for (let i = 0; i < 4; i++) {
      const who = actor.rules.turnSeat() === 0 ? a : b;
      await actor.move(who.userId, actor.seq, firstDamesMove(actor));
    }
    const moves = [...actor.rules.moves];
    const clocks = actor.clocks()!;
    // Un second serveur sur la même base, comme après un redémarrage.
    const app2 = await buildApp({ config: t.config, pool: t.db.pool, clock: t.clock, mailTransport: new MemoryTransport(), pushSender: new MemoryPushSender(), logger: false });
    await app2.ready();
    const resumed = (await app2.games.get(actor.id))!;
    expect(resumed.rules.moves).toEqual(moves);
    expect(resumed.clocks()!['1']!.remainingMs).toBe(clocks['1']!.remainingMs);
    expect(resumed.rules.turnSeat()).toBe(0);
    await resumed.move(a.userId, resumed.seq, firstDamesMove(resumed));
    expect(resumed.rules.moves).toHaveLength(5);
    await resumed.resign(b.userId);
    await app2.close();
    await wa.close();
    await wb.close();
  });
});

describe('Ludo en ligne', () => {
  let a: TestMember;
  let b: TestMember;
  beforeAll(async () => {
    a = await createMember(t, { verified: true });
    b = await createMember(t, { verified: true });
  });

  /** Les 20 premières actions passent par la WebSocket (débit limité), la suite par l'acteur. */
  async function playLudo(actor: GameActor, clients: Map<string, TestWsClient>, maxSteps = 4000): Promise<void> {
    for (let step = 0; step < maxSteps && actor.status === 'playing'; step++) {
      const turn = actor.rules.turnSeat()!;
      const userId = actor.config.seats[turn]!.userId!;
      const ws = clients.get(userId)!;
      const state = actor.rules.state as LudoState;
      const id = `s${step}`;
      const seed = 'a1b2c3d4e5f60718' + step.toString(16).padStart(4, '0');
      if (step >= 20) {
        if (state.phase === 'roll') await actor.roll(userId, actor.seq, seed);
        else await actor.move(userId, actor.seq, tokenNotation(state, distinctMoves(ludoLegal(state))[0]!));
        continue;
      }
      if (state.phase === 'roll') {
        ws.send({ t: 'game.roll', id, gameId: actor.id, seq: actor.seq, clientSeed: seed });
      } else {
        const move = distinctMoves(ludoLegal(state))[0]!;
        ws.send({ t: 'game.move', id, gameId: actor.id, seq: actor.seq, move: tokenNotation(state, move) });
      }
      const reply = await ws.next((m) => m.re === id);
      if (reply.t === 'error') throw new Error(`refusé : ${String(reply.code)}`);
    }
  }

  it('partie complète avec mise : dés vérifiables, pot au gagnant, secret révélé à la fin', async () => {
    const before = { a: await balanceOf(t.app.db, a.userId), b: await balanceOf(t.app.db, b.userId) };
    const wa = await connectWs(t, a);
    const wb = await connectWs(t, b);
    const actor = await create({ variant: 'ludo_rapide', seats: [seat(a, true), seat(b, true)], stake: 40, turnMs: 30_000 });
    wa.send({ t: 'game.subscribe', id: 'sub', gameId: actor.id });
    const first = await wa.next('game.state');
    expect(first.diceCommitment).toMatch(/^[0-9a-f]{64}$/);

    const during = await t.app.inject({ method: 'GET', url: `/v1/games/${actor.id}/dice`, headers: a.headers });
    expect(during.json<DiceProof>().serverSeed).toBeNull();

    await playLudo(actor, new Map([[a.userId, wa], [b.userId, wb]]));
    expect(actor.status).toBe('finished');
    await t.app.games.settled(actor.id);
    const winnerSeat = actor.winners()[0]!;
    const winner = winnerSeat === 0 ? a : b;
    const loser = winnerSeat === 0 ? b : a;
    expect(await balanceOf(t.app.db, winner.userId)).toBe((winner === a ? before.a : before.b) + 40);
    expect(await balanceOf(t.app.db, loser.userId)).toBe((loser === a ? before.a : before.b) - 40);

    const proof = (await t.app.inject({ method: 'GET', url: `/v1/games/${actor.id}/dice`, headers: b.headers })).json<DiceProof>();
    expect(proof.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.commitment).toBe(first.diceCommitment);
    expect(proof.rolls.length).toBeGreaterThan(10);
    expect(verifyGame({ gameId: actor.id, commitment: proof.commitment, serverSeed: proof.serverSeed!, rolls: proof.rolls.map((r) => ({ rollIndex: r.rollIndex, clientSeed: r.clientSeed, value: r.value })) })).toMatchObject({ ok: true });

    const s = await summary(actor.id, a);
    expect(s.moves.length).toBe(actor.rules.moves.length);
    expect(s.dice).toEqual({ commitment: proof.commitment, revealed: true });
    expect(finished.find((e) => e.gameId === actor.id)?.tokensHome).toBeDefined();
    await wa.close();
    await wb.close();
  });

  it('30 s sans jouer → la machine joue le tour ; coupé plus de 60 s → sorti, dernier', async () => {
    const wa = await connectWs(t, a);
    const wb = await connectWs(t, b);
    const c = await createMember(t, { verified: true });
    const wc = await connectWs(t, c);
    const actor = await create({ variant: 'ludo_classique', seats: [seat(a), seat(b), seat(c)], turnMs: 30_000 });
    expect(actor.rules.turnSeat()).toBe(0);
    t.clock.advance(30_001);
    await t.app.games.tick();
    await t.app.games.settled(actor.id);
    // La machine a lancé pour le siège 0 (et joué s'il le fallait) : la main est passée.
    const proof = (await t.app.inject({ method: 'GET', url: `/v1/games/${actor.id}/dice`, headers: a.headers })).json<DiceProof>();
    expect(proof.rolls[0]).toMatchObject({ seat: 0, byMachine: true });

    await goOffline(wb, b.userId, actor);
    t.clock.advance(61_000);
    await t.app.games.tick();
    await t.app.games.settled(actor.id);
    const state = actor.rules.state as LudoState;
    expect(state.seats[1]!.status).toBe('out');
    expect(actor.rules.moves).toContain('x:1');
    // Les deux autres continuent.
    expect(actor.status).toBe('playing');
    await actor.resign(c.userId);
    await t.app.games.settled(actor.id);
    expect(actor.outcome?.places).toEqual({ 0: 1, 2: 2, 1: 3 });
    await wa.close();
    await wc.close();
  });
});

describe('Machine en ligne avec pari', () => {
  it('Dames : le pari est bloqué, la machine joue sur le serveur, perdu à l’abandon', async () => {
    const m = await createMember(t, { verified: true });
    const before = await balanceOf(t.app.db, m.userId);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/games/machine',
      headers: m.headers,
      payload: { family: 'dames', variant: 'dames8', difficulty: 'facile', mode: 'chosen', bet: 50 },
    });
    expect(res.statusCode).toBe(201);
    const { gameId } = res.json<{ gameId: string }>();
    expect(await balanceOf(t.app.db, m.userId)).toBe(before - 50);
    const actor = (await t.app.games.get(gameId))!;
    // En 8×8, les noirs (la machine) commencent : elle joue toute seule.
    await t.app.games.settled(gameId);
    expect(actor.rules.moves).toHaveLength(1);
    await actor.move(m.userId, actor.seq, firstDamesMove(actor));
    await t.app.games.settled(gameId);
    expect(actor.rules.moves).toHaveLength(3);
    // Pas d'absence contre la machine : on reprend plus tard.
    t.clock.advance(120_000);
    await t.app.games.tick();
    expect(actor.status).toBe('playing');
    await actor.resign(m.userId);
    await t.app.games.settled(gameId);
    const s = await summary(gameId, m);
    expect(s).toMatchObject({ context: 'machine', outcome: { reason: 'resign' }, seats: [{ seat: 0, userId: m.userId }, { seat: 1, userId: null, machine: { difficulty: 'facile' } }] });
    expect(s.settlement?.betNet).toBe(-50);
    expect(await balanceOf(t.app.db, m.userId)).toBe(before - 50 + (s.settlement!.participation ?? 0));
  });

  it('Ludo contre deux machines, sans pari ; refus d’un pari d’invité', async () => {
    const m = await createMember(t, { verified: true });
    const res = await t.app.inject({ method: 'POST', url: '/v1/games/machine', headers: m.headers, payload: { family: 'ludo', variant: 'ludo_classique', difficulty: 'facile', mode: 'chosen', bet: 0, machines: 2 } });
    expect(res.statusCode).toBe(201);
    const actor = (await t.app.games.get(res.json<{ gameId: string }>().gameId))!;
    expect(actor.config.seats.map((s) => s.userId === null)).toEqual([false, true, true]);
    const ws = await connectWs(t, m);
    ws.send({ t: 'game.roll', id: 'r', gameId: actor.id, seq: actor.seq, clientSeed: '00112233445566778899' });
    expect((await ws.next((x) => x.re === 'r')).t).toBe('game.ack');
    await t.app.games.settled(actor.id);
    await actor.resign(m.userId);
    await t.app.games.settled(actor.id);
    expect(actor.status).toBe('finished');
    await ws.close();

    const guest = await createGuest(t);
    const refused = await t.app.inject({ method: 'POST', url: '/v1/games/machine', headers: guest.headers, payload: { family: 'ludo', variant: 'ludo_classique', difficulty: 'facile', mode: 'chosen', bet: 0 } });
    expect(refused.statusCode).toBe(403);
  });
});

describe('Spectateurs et pronostics', () => {
  it('un invité regarde ; pronostics à 50 cauris fermés au coup 10 ; pot partagé ; réactions montrées à la fin', async () => {
    const a = await createMember(t, { verified: true });
    const b = await createMember(t, { verified: true });
    const p1 = await createMember(t, { verified: true });
    const p2 = await createMember(t, { verified: true });
    const guest = await createGuest(t);
    const wa = await connectWs(t, a);
    const wb = await connectWs(t, b);
    const actor = await create({ variant: 'dames10', seats: [seat(a), seat(b)], clock: { initialMs: 300_000, incrementMs: 3_000 } });

    wa.send({ t: 'game.subscribe', id: 'a', gameId: actor.id });
    await wa.next('game.state');
    const wg = await connectWs(t, guest);
    wg.send({ t: 'game.subscribe', id: 'g', gameId: actor.id, spectate: true });
    expect((await wg.next('game.state')).mySeats).toEqual([]);
    wg.send({ t: 'game.react', id: 're', gameId: actor.id, key: 'reaction.bravo' });

    const guestView = await t.app.inject({ method: 'GET', url: `/v1/games/${actor.id}/predictions`, headers: guest.headers });
    expect(guestView.json<PredictionsView>()).toMatchObject({ open: true, eligible: false, stake: 50 });
    const player = await t.app.inject({ method: 'POST', url: `/v1/games/${actor.id}/predictions`, headers: a.headers, payload: { seat: 0 } });
    expect(player.json()).toMatchObject({ error: { code: 'prediction.player' } });

    const before = { p1: await balanceOf(t.app.db, p1.userId), p2: await balanceOf(t.app.db, p2.userId) };
    expect((await t.app.inject({ method: 'POST', url: `/v1/games/${actor.id}/predictions`, headers: p1.headers, payload: { seat: 1 } })).statusCode).toBe(200);
    const view = await t.app.inject({ method: 'POST', url: `/v1/games/${actor.id}/predictions`, headers: p2.headers, payload: { seat: 0 } });
    expect(view.json<PredictionsView>().pools).toEqual([
      { seat: 0, count: 1, total: 50 },
      { seat: 1, count: 1, total: 50 },
    ]);
    expect(await balanceOf(t.app.db, p1.userId)).toBe(before.p1 - 50);

    for (let i = 0; i < 18; i++) {
      const who = actor.rules.turnSeat() === 0 ? a : b;
      await actor.move(who.userId, actor.seq, firstDamesMove(actor));
    }
    const late = await createMember(t, { verified: true });
    const closed = await t.app.inject({ method: 'POST', url: `/v1/games/${actor.id}/predictions`, headers: late.headers, payload: { seat: 0 } });
    expect(closed.json()).toMatchObject({ error: { code: 'prediction.closed' } });

    // Pendant la partie, les joueurs ne voient pas les réactions des spectateurs.
    const watch = await t.app.inject({ method: 'GET', url: `/v1/games/${actor.id}/watch`, headers: a.headers });
    expect(watch.json<{ reactions: unknown[] }>().reactions).toEqual([]);

    await actor.resign(a.userId);
    const end = await wa.next('game.end');
    expect(end.reactions).toEqual([{ key: 'bravo', count: 1 }]);
    await t.app.games.settled(actor.id);
    expect(await balanceOf(t.app.db, p1.userId)).toBe(before.p1 + 50);
    expect(await balanceOf(t.app.db, p2.userId)).toBe(before.p2 - 50);
    await Promise.all([wa.close(), wb.close(), wg.close()]);
  });

  it('parties en direct et mes parties en cours', async () => {
    const a = await createMember(t, { verified: true });
    const b = await createMember(t, { verified: true });
    const actor = await create({ variant: 'dames10', seats: [seat(a), seat(b)], clock: { initialMs: 300_000, incrementMs: 3_000 } });
    const live = await t.app.inject({ method: 'GET', url: '/v1/games/live?family=dames', headers: a.headers });
    expect(live.json<{ items: { id: string }[] }>().items.map((g) => g.id)).toContain(actor.id);
    const mine = await t.app.inject({ method: 'GET', url: '/v1/games/mine', headers: a.headers });
    expect(mine.json<{ items: { id: string; myTurn: boolean }[] }>().items).toEqual([expect.objectContaining({ id: actor.id, myTurn: true })]);
    await actor.resign(a.userId);
  });
});

describe('Ligues (contrat C3)', () => {
  it('createGame de ligue : pendule, classée, et onGameFinished porte la ligue et le départage', async () => {
    const a = await createMember(t, { verified: true });
    const b = await createMember(t, { verified: true });
    const { leagueGames } = await import('../leagues/games.js');
    const port = leagueGames()!;
    const league = { leagueId: '00000000-0000-4000-8000-000000000001', matchId: '00000000-0000-4000-8000-000000000002' };
    const { gameId } = await transaction(t.app.db, (tx) =>
      port.createGame(tx, { context: 'league', variant: 'dames10', seats: [{ userId: a.userId }, { userId: b.userId }], clock: { initialMs: 600_000, incrementMs: 5_000 }, rated: true, stake: 0, league }),
    );
    const actor = (await t.app.games.get(gameId))!;
    expect(actor.config).toMatchObject({ context: 'league', ranked: true, rules: { clock: { initialMs: 600_000 }, league } });
    await actor.resign(b.userId);
    await t.app.games.settled(gameId);
    expect(finished.find((e) => e.gameId === gameId)).toMatchObject({ context: 'league', league, pieceDiff: 0, outcome: { places: { '0': 1, '1': 2 } } });
  });
});
