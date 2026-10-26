/**
 * Ligues : tests de bout en bout avec une vraie base, l'horloge de test et une fausse table
 * de jeu à la place du service des parties en ligne (contrat C3).
 */
import { randomUUID } from 'node:crypto';
import { splitPot } from '@kwatt/domain';
import {
  LeagueDetailSchema,
  LeagueExclusionViewSchema,
  LeagueMatchViewSchema,
  type CreateLeagueRequest,
  type LeagueDetail,
  type LeagueMatchCard,
  type LeagueMatchView,
} from '@kwatt/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createGuest, createMember, type TestApp, type TestMember, type TestUser } from '../../test/helpers.js';
import { balanceOf, escrowBalance } from '../economy/ledger.js';
import { setLeagueGames, type CreateLeagueGameInput, type LeagueGameFinished } from './games.js';
import { cautionKey, potKey } from './money.js';

let t: TestApp;

/** Fausse table de jeu : retient les parties créées, et termine celles qu'on lui demande. */
const games = new Map<string, CreateLeagueGameInput>();
let finished: ((e: LeagueGameFinished) => Promise<void> | void) | null = null;

beforeAll(async () => {
  setLeagueGames({
    async createGame(_tx, input) {
      const gameId = randomUUID();
      games.set(gameId, input);
      return { gameId };
    },
    onGameFinished(listener) {
      finished = listener;
    },
  });
  t = await buildTestApp({ suite: 'leagues' });
});
afterAll(async () => {
  setLeagueGames(null);
  await t.close();
});
beforeEach(() => {
  // 1er novembre 2026, 09:00 à Douala.
  t.clock.set(new Date('2026-11-01T08:00:00.000Z'));
});

const DAY = 86_400_000;

/** Requête au nom d'un joueur ; une ligue dure des semaines, on renouvelle son jeton au besoin. */
async function send(user: TestUser, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
  const go = () => t.app.inject({ method, url, headers: user.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const res = await go();
  if (res.statusCode !== 401 || res.json<{ error: { code: string } }>().error.code !== 'auth.token_expired') return res;
  const r = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: user.refreshToken, device: user.device } });
  expect(r.statusCode, r.body).toBe(200);
  const body = r.json<{ accessToken: string; refreshToken: string }>();
  user.accessToken = body.accessToken;
  user.refreshToken = body.refreshToken;
  user.headers.authorization = `Bearer ${body.accessToken}`;
  return go();
}

async function req<T>(user: TestUser, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, status = 200): Promise<T> {
  const res = await send(user, method, url, payload);
  expect(res.statusCode, `${method} ${url} : ${res.body}`).toBe(status);
  return res.json<T>();
}

async function errorOf(user: TestUser, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown): Promise<{ status: number; code: string }> {
  const res = await send(user, method, url, payload);
  return { status: res.statusCode, code: res.json<{ error: { code: string } }>().error?.code };
}

const detail = async (user: TestUser, id: string) => LeagueDetailSchema.parse(await req(user, 'GET', `/v1/leagues/${id}`));

async function setRating(user: TestMember, variant: string, rating: number): Promise<void> {
  await t.db.pool.query(
    `INSERT INTO player_ratings (user_id, variant, rating) VALUES ($1, $2, $3) ON CONFLICT (user_id, variant) DO UPDATE SET rating = $3`,
    [user.userId, variant, rating],
  );
}

const tick = () => t.app.jobs.runNow('leagues.tick');

async function allMatches(leagueId: string): Promise<{ id: string; round: number; players: string[]; match_at: Date; status: string; stage: string; game_id: string | null }[]> {
  const r = await t.db.pool.query(
    `SELECT id, round, players::text[] AS players, match_at, status, stage, game_id FROM league_matches WHERE league_id = $1 ORDER BY round, id`,
    [leagueId],
  );
  return r.rows;
}

/** Résultat voulu pour un match de dames : qui gagne, ou qui est absent. */
type Plan = 'home' | 'away' | 'draw' | 'home_absent' | 'away_absent' | 'both_absent';

/**
 * Joue une journée : à l'heure du match, les présents entrent dans la salle (la partie démarre),
 * 11 minutes plus tard la tâche constate les absences, puis les parties se terminent.
 */
async function playRound(leagueId: string, round: number, users: Map<string, TestUser>, plan: (players: string[]) => Plan): Promise<void> {
  const due = (await allMatches(leagueId)).filter((m) => m.round === round && m.status === 'scheduled');
  if (due.length === 0) return;
  // Les matchs d'une journée peuvent avoir des heures différentes : on joue la plus tôt d'abord.
  const first = Math.min(...due.map((m) => m.match_at.getTime()));
  const matches = due.filter((m) => m.match_at.getTime() === first);
  t.clock.set(new Date(first));
  const plans = new Map(matches.map((m) => [m.id, plan(m.players)]));
  for (const m of matches) {
    const p = plans.get(m.id)!;
    const present = m.players.filter((id, i) => !(p === 'both_absent' || (p === 'home_absent' && i === 0) || (p === 'away_absent' && i === 1)));
    for (const id of present) await req(users.get(id)!, 'POST', `/v1/leagues/${leagueId}/matches/${m.id}/arrive`);
  }
  t.clock.advance(11 * 60_000);
  await tick();
  for (const m of await allMatches(leagueId)) {
    if (m.round !== round || m.status !== 'playing' || !m.game_id) continue;
    const p = plans.get(m.id)!;
    await finished!({
      gameId: m.game_id,
      context: 'league',
      league: { leagueId, matchId: m.id },
      outcome: { places: p === 'draw' ? { 0: 1, 1: 1 } : p === 'home' ? { 0: 1, 1: 2 } : { 0: 2, 1: 1 }, draw: p === 'draw', reason: 'no_moves' },
      seats: m.players.map((userId, seat) => ({ seat, userId })),
      pieceDiff: p === 'home' ? 3 : p === 'away' ? -2 : 0,
    });
  }
  await playRound(leagueId, round, users, plan);
}

function publicLeague(over: Partial<CreateLeagueRequest> = {}): CreateLeagueRequest {
  const now = t.clock.now().getTime();
  return {
    name: 'Ligue Littoral — Dames',
    game: 'dames',
    access: 'public',
    format: 'championship',
    maxPlaces: 6,
    entry: 100,
    minRank: null,
    boardRules: { policy: 'imposed', allowed: ['dames10'], defaultBoard: 'dames10' },
    defaultTime: '20:00',
    firstDay: '2026-11-05',
    registrationClosesAt: new Date(now + 2 * DAY).toISOString(),
    ...over,
  };
}

describe('ligue publique de bout en bout', () => {
  it('inscriptions, validation, journées, forfaits, exclusion, clôture : argent exact au cauris près', async () => {
    const creator = await createMember(t, { pseudo: `armand_${Date.now() % 1e6}` });
    // Échelon Ancien du kwatt (niveau 10 = force 1 200) pour créer une ligue publique.
    expect((await errorOf(creator, 'POST', '/v1/leagues', publicLeague())).code).toBe('league.rank_too_low');
    await setRating(creator, 'dames10', 1250);
    const created = LeagueDetailSchema.parse(await req(creator, 'POST', '/v1/leagues', publicLeague(), 201));
    const id = created.id;
    expect(created).toMatchObject({ status: 'registration', caution: 300, entry: 100, minPlayers: 4, potIfFull: 750 });
    expect(await balanceOf(t.db.pool, creator.userId)).toBe(200);
    expect(await escrowBalance(t.db.pool, cautionKey(id))).toBe(300);

    // Six joueurs s'inscrivent : chacun bloque 100 cauris.
    const players: TestMember[] = [];
    for (let i = 0; i < 6; i++) players.push(await createMember(t));
    const guest = await createGuest(t);
    expect((await errorOf(guest, 'POST', `/v1/leagues/${id}/join`)).code).toBe('league.guest_public');
    const teen = await createMember(t, { birthYear: 2011 });
    expect((await errorOf(teen, 'POST', `/v1/leagues/${id}/join`)).code).toBe('league.underage_paid');
    for (const p of players) await req(p, 'POST', `/v1/leagues/${id}/join`);
    expect((await errorOf(players[0]!, 'POST', `/v1/leagues/${id}/join`)).code).toBe('league.already_member');
    const late = await createMember(t);
    expect((await errorOf(late, 'POST', `/v1/leagues/${id}/join`)).code).toBe('league.full');
    for (const p of players) expect(await balanceOf(t.db.pool, p.userId)).toBe(400);
    expect(await escrowBalance(t.db.pool, potKey(id))).toBe(600);

    // Un joueur part puis revient : son entrée lui est rendue, puis rebloquée.
    await req(players[5]!, 'POST', `/v1/leagues/${id}/leave`);
    expect(await balanceOf(t.db.pool, players[5]!.userId)).toBe(500);
    await req(players[5]!, 'POST', `/v1/leagues/${id}/join`);
    expect(await balanceOf(t.db.pool, players[5]!.userId)).toBe(400);

    // Liste des ligues publiques.
    const list = await req<{ items: { id: string; placesLeft: number }[] }>(late, 'GET', '/v1/leagues?scope=public&game=dames');
    expect(list.items.find((l) => l.id === id)).toMatchObject({ placesLeft: 0 });

    // Clôture des inscriptions, puis validation par le créateur : tirage, calendrier, bonus de 25 %.
    t.clock.advance(2 * DAY + 60_000);
    await tick();
    expect((await detail(creator, id)).status).toBe('awaiting_validation');
    expect((await errorOf(players[0]!, 'POST', `/v1/leagues/${id}/validate`)).code).toBe('league.not_creator');
    const validated = LeagueDetailSchema.parse(await req(creator, 'POST', `/v1/leagues/${id}/validate`));
    expect(validated).toMatchObject({ status: 'running', pot: 750, totalRounds: 5, totalMatches: 15, firstDay: '2026-11-05' });
    expect(validated.drawSeed).toMatch(/^[0-9a-f]{32}$/);
    expect(validated.roundMatches).toHaveLength(3);
    expect((await errorOf(players[0]!, 'POST', `/v1/leagues/${id}/leave`)).code).toBe('league.wrong_status');

    const users = new Map<string, TestUser>(players.map((p) => [p.userId, p]));
    const absentee = players[2]!.userId;

    // Écran 34 : heure proposée par l'un, acceptée par l'autre.
    const first = (await allMatches(id)).find((m) => m.round === 1 && !m.players.includes(absentee))!;
    const [h, a] = first.players as [string, string];
    let view = LeagueMatchViewSchema.parse(await req(users.get(h)!, 'POST', `/v1/leagues/${id}/matches/${first.id}/time`, { time: '18:00' }));
    expect(view.match.timeAgreed).toBe(false);
    expect(view.match.matchAt).toBe('2026-11-05T19:00:00.000Z');
    view = LeagueMatchViewSchema.parse(await req(users.get(a)!, 'POST', `/v1/leagues/${id}/matches/${first.id}/time`, { time: '18:00' }));
    expect(view).toMatchObject({ match: { timeAgreed: true, matchAt: '2026-11-05T17:00:00.000Z' }, boardChooser: 'organizer' });
    expect((await errorOf(users.get(h)!, 'POST', `/v1/leagues/${id}/matches/${first.id}/time`, { time: '17:15' })).code).toBe('league.time_invalid');
    // Trop tôt pour entrer dans la salle.
    expect((await errorOf(users.get(h)!, 'POST', `/v1/leagues/${id}/matches/${first.id}/arrive`)).code).toBe('league.too_early');

    // Journée 1 : l'absent fait forfait (amende de 10, versée au pot).
    const winsHome = (p: string[]) => (p.includes(absentee) ? (p[0] === absentee ? 'home_absent' : 'away_absent') : 'home');
    // Le match avancé à 18:00 se joue d'abord, puis les autres à 20:00.
    await playRound(id, 1, users, winsHome);
    expect(await balanceOf(t.db.pool, absentee)).toBe(390);
    expect(await escrowBalance(t.db.pool, potKey(id))).toBe(760);
    const started = [...games.values()].filter((g) => g.league.leagueId === id);
    expect(started.length).toBeGreaterThan(0);
    expect(started[0]).toMatchObject({ context: 'league', variant: 'dames10', rated: true, stake: 0, clock: { initialMs: 600_000, incrementMs: 5000 } });

    // Journée 2 : second forfait de suite → exclusion. Il a joué 2 matchs sur 5 : tout est annulé.
    await playRound(id, 2, users, winsHome);
    let d = await detail(creator, id);
    expect(d.exclusions.map((e) => e.player.userId)).toEqual([absentee]);
    expect(d.members.find((m) => m.player.userId === absentee)?.status).toBe('excluded');
    // ½ × 100 × 3 restants ÷ 5 = 30 rendus ; ses deux amendes (20) restent au pot.
    expect(await balanceOf(t.db.pool, absentee)).toBe(380 + 30);
    expect(await escrowBalance(t.db.pool, potKey(id))).toBe(770 - 30);
    const exclusion = LeagueExclusionViewSchema.parse(await req(players[0]!, 'GET', `/v1/leagues/${id}/exclusions/${absentee}`));
    expect(exclusion).toMatchObject({
      policy: 'annulled',
      reason: 'consecutive',
      forfeitRounds: [1, 2],
      elapsed: 2,
      totalMatches: 5,
      remainingPlayers: 5,
      calendar: { mode: 'bye' },
      money: { refund: 30, fines: 20, potBefore: 750, potAfter: 740 },
    });
    expect(exclusion.changes.every((c) => c.result === 'forfeit_win' && c.points === -3)).toBe(true);
    expect(exclusion.calendar.rested).toHaveLength(3);
    // Les victoires par forfait contre lui sont annulées : personne n'a de point de lui.
    expect(d.standings.find((r) => r.player.userId === absentee)).toMatchObject({ excluded: true });

    // Journées 3 à 5 : tout se joue normalement (le domicile gagne).
    for (let r = 3; r <= 5; r++) await playRound(id, r, users, () => 'home');
    d = await detail(creator, id);
    expect(d.status).toBe('finished');
    expect(d.medals.map((m) => m.kind)).toEqual(['or', 'argent', 'bronze']);

    // Partage du pot de 740 : 35 / 20 / 10 / 30 (entre ceux qui sont allés au bout) / 5.
    const ranking = d.standings.filter((r) => !r.excluded).map((r) => r.player.userId);
    const split = splitPot({ pot: 740, ranking, finishers: ranking, creatorId: creator.userId });
    expect(split).toMatchObject({ first: 259, second: 148, third: 74, participationEach: 44, creator: 37 });
    expect(await escrowBalance(t.db.pool, potKey(id))).toBe(0);
    expect(await escrowBalance(t.db.pool, cautionKey(id))).toBe(0);
    for (const userId of ranking) expect(await balanceOf(t.db.pool, userId)).toBe(400 + (split.payouts[userId] ?? 0));
    expect(await balanceOf(t.db.pool, creator.userId)).toBe(500 + 37);
    // Le champion reçoit la carte trophée.
    const card = await t.db.pool.query(
      `SELECT 1 FROM owned_items o JOIN items i ON i.id = o.item_id WHERE o.user_id = $1 AND i.code = 'card_trophee_ngondo'`,
      [ranking[0]],
    );
    expect(card.rowCount).toBe(1);
    // Notifications : rappels, forfait, exclusion, fin.
    const kinds = await t.db.pool.query<{ kind: string }>(`SELECT DISTINCT kind FROM notifications WHERE user_id = $1`, [ranking[0]]);
    expect(kinds.rows.map((k) => k.kind)).toEqual(expect.arrayContaining(['league.started', 'league.match_ready', 'league.finished']));
  });

  it('pas assez d’inscrits à la clôture : annulée, entrées et caution rendues', async () => {
    const creator = await createMember(t);
    await setRating(creator, 'dames10', 1300);
    const { id } = LeagueDetailSchema.parse(await req(creator, 'POST', '/v1/leagues', publicLeague({ maxPlaces: 8 }), 201));
    const p = await createMember(t);
    await req(p, 'POST', `/v1/leagues/${id}/join`);
    t.clock.advance(2 * DAY + 60_000);
    await tick();
    expect((await detail(creator, id)).status).toBe('cancelled');
    expect(await balanceOf(t.db.pool, p.userId)).toBe(500);
    expect(await balanceOf(t.db.pool, creator.userId)).toBe(500);
  });

  it('pas validée sous 48 h : annulée et remboursée', async () => {
    const creator = await createMember(t);
    await setRating(creator, 'dames10', 1300);
    const { id } = LeagueDetailSchema.parse(await req(creator, 'POST', '/v1/leagues', publicLeague({ maxPlaces: 4, firstDay: '2026-11-10' }), 201));
    const ps = [await createMember(t), await createMember(t), await createMember(t), await createMember(t)];
    for (const p of ps) await req(p, 'POST', `/v1/leagues/${id}/join`);
    t.clock.advance(2 * DAY + 60_000);
    await tick();
    const d = await detail(creator, id);
    expect(d.status).toBe('awaiting_validation');
    expect(d.validationDeadline).not.toBeNull();
    // Le créateur retire un inscrit avant validation : il est remboursé.
    await req(creator, 'DELETE', `/v1/leagues/${id}/members/${ps[3]!.userId}`);
    expect(await balanceOf(t.db.pool, ps[3]!.userId)).toBe(500);
    t.clock.advance(48 * 3_600_000 + 60_000);
    await tick();
    expect((await detail(creator, id)).status).toBe('cancelled');
    for (const p of ps) expect(await balanceOf(t.db.pool, p.userId)).toBe(500);
    expect(await balanceOf(t.db.pool, creator.userId)).toBe(500);
  });

  it('annulée par le créateur après validation : la caution est partagée entre les inscrits', async () => {
    const creator = await createMember(t);
    await setRating(creator, 'dames10', 1300);
    const { id } = LeagueDetailSchema.parse(await req(creator, 'POST', '/v1/leagues', publicLeague({ maxPlaces: 4, entry: 50 }), 201));
    const ps = [await createMember(t), await createMember(t), await createMember(t)];
    for (const p of ps) await req(p, 'POST', `/v1/leagues/${id}/join`);
    expect((await errorOf(creator, 'POST', `/v1/leagues/${id}/validate`)).code).toBe('league.wrong_status');
    await req(await createMember(t).then(async (p) => (ps.push(p), p)), 'POST', `/v1/leagues/${id}/join`);
    // Complète : le créateur peut valider sans attendre la clôture.
    await req(creator, 'POST', `/v1/leagues/${id}/validate`);
    await req(creator, 'POST', `/v1/leagues/${id}/cancel`);
    // Caution de 200 partagée entre 4 : 50 chacun, entrée rendue.
    for (const p of ps) expect(await balanceOf(t.db.pool, p.userId)).toBe(550);
    expect(await balanceOf(t.db.pool, creator.userId)).toBe(300);
    expect(await escrowBalance(t.db.pool, potKey(id))).toBe(0);
  });
});

describe('ligue privée', () => {
  async function privateLeague(creator: TestMember, over: Partial<CreateLeagueRequest> = {}): Promise<LeagueDetail> {
    return LeagueDetailSchema.parse(
      await req(
        creator,
        'POST',
        '/v1/leagues',
        {
          name: 'Championnat du Kwatt',
          game: 'dames',
          access: 'private',
          format: 'championship',
          maxPlaces: 10,
          entry: 0,
          doubleRound: true,
          relegated: 2,
          boardRules: { policy: 'home', allowed: ['dames10', 'dames8'], defaultBoard: 'dames10' },
          defaultTime: '18:00',
          rhythm: 'weekly',
          firstDay: '2026-11-01',
          ...over,
        },
        201,
      ),
    );
  }

  it('code d’invitation, invité accepté si gratuite, lancement, planche au choix de qui reçoit', async () => {
    const creator = await createMember(t);
    const league = await privateLeague(creator);
    expect(league.members).toHaveLength(1);
    expect(league.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const guest = await createGuest(t);
    const found = LeagueDetailSchema.parse(await req(guest, 'GET', `/v1/leagues/by-code/${league.code.slice(0, 3)}-${league.code.slice(3).toLowerCase()}`));
    expect(found.me).toMatchObject({ member: false, joinRefusal: null });
    await req(guest, 'POST', `/v1/leagues/${league.id}/join`);
    const friend = await createMember(t);
    await req(friend, 'POST', `/v1/leagues/${league.id}/join`);
    expect((await errorOf(creator, 'POST', `/v1/leagues/${league.id}/leave`)).code).toBe('league.creator_cannot_leave');
    expect((await errorOf(friend, 'POST', `/v1/leagues/${league.id}/start`)).code).toBe('league.not_creator');
    const started = LeagueDetailSchema.parse(await req(creator, 'POST', `/v1/leagues/${league.id}/start`));
    // 3 joueurs en aller-retour : 6 journées hebdomadaires, un exempt par journée.
    expect(started).toMatchObject({ status: 'running', totalRounds: 6, totalMatches: 6, firstDay: '2026-11-01' });
    const mine = await req<{ items: { id: string; myPosition: number | null }[] }>(guest, 'GET', '/v1/leagues?scope=mine');
    expect(mine.items.map((l) => l.id)).toContain(league.id);

    const matches = await allMatches(league.id);
    expect(new Set(matches.map((m) => m.match_at.toISOString().slice(11, 16)))).toEqual(new Set(['17:00']));
    const m = matches.find((x) => x.round === 2)!;
    const users = new Map<string, TestUser>([
      [creator.userId, creator],
      [guest.userId, guest],
      [friend.userId, friend],
    ]);
    const home = users.get(m.players[0]!)!;
    const away = users.get(m.players[1]!)!;
    let v: LeagueMatchView = LeagueMatchViewSchema.parse(await req(home, 'GET', `/v1/leagues/${league.id}/matches/${m.id}`));
    expect(v.boardChooser).toBe('me');
    expect(v.boardOdds.map((o) => o.board)).toEqual(['dames10', 'dames8']);
    expect((await errorOf(away, 'POST', `/v1/leagues/${league.id}/matches/${m.id}/board`, { board: 'dames8' })).code).toBe('league.board_not_allowed');
    v = LeagueMatchViewSchema.parse(await req(home, 'POST', `/v1/leagues/${league.id}/matches/${m.id}/board`, { board: 'dames8' }));
    expect(v.boardChoices[home.userId]).toBe('dames8');
    // La journée 2 se joue sur la planche choisie.
    await playRound(league.id, 1, users, () => 'draw');
    await playRound(league.id, 2, users, () => 'away');
    const g = [...games.values()].find((x) => x.league.matchId === m.id);
    expect(g?.variant).toBe('dames8');
    expect((await detail(creator, league.id)).currentRound).toBe(3);
  });

  it('sans le service des parties, la salle prévient et la partie démarre dès son retour', async () => {
    const creator = await createMember(t);
    const league = await privateLeague(creator, { doubleRound: false, rhythm: 'daily', defaultTime: '20:00', boardRules: { policy: 'imposed', allowed: ['dames10'], defaultBoard: 'dames10' } });
    const friend = await createMember(t);
    await req(friend, 'POST', `/v1/leagues/${league.id}/join`);
    await req(creator, 'POST', `/v1/leagues/${league.id}/start`);
    const [m] = await allMatches(league.id);
    t.clock.set(m!.match_at);
    const saved = (await import('./games.js')).leagueGames();
    setLeagueGames(null);
    await req(creator, 'POST', `/v1/leagues/${league.id}/matches/${m!.id}/arrive`);
    expect((await errorOf(friend, 'POST', `/v1/leagues/${league.id}/matches/${m!.id}/arrive`)).code).toBe('league.games_unavailable');
    setLeagueGames(saved);
    t.clock.advance(60_000);
    await tick();
    expect((await allMatches(league.id))[0]?.status).toBe('playing');
  });
});

describe('coupe', () => {
  it('poules, finale aller-retour, manche décisive de 5 minutes après une égalité', async () => {
    const creator = await createMember(t);
    const { id } = LeagueDetailSchema.parse(
      await req(
        creator,
        'POST',
        '/v1/leagues',
        {
          name: 'Coupe des Cousins',
          game: 'dames',
          access: 'private',
          format: 'cup',
          maxPlaces: 8,
          entry: 50,
          groups: 2,
          qualifiersPerGroup: 1,
          boardRules: { policy: 'imposed', allowed: ['dames10'], defaultBoard: 'dames10' },
          firstDay: '2026-11-02',
        },
        201,
      ),
    );
    const ps = [creator, await createMember(t), await createMember(t), await createMember(t)];
    for (const p of ps.slice(1)) await req(p, 'POST', `/v1/leagues/${id}/join`);
    await req(creator, 'POST', `/v1/leagues/${id}/start`);
    const users = new Map<string, TestUser>(ps.map((p) => [p.userId, p]));
    let d = await detail(creator, id);
    expect(d.groupTables).toHaveLength(2);
    // Poules de 2 : une journée ; le domicile gagne.
    await playRound(id, 1, users, () => 'home');
    d = await detail(creator, id);
    expect(d.knockout).toHaveLength(1);
    const final = d.knockout[0]!;
    expect(final.matches).toHaveLength(2);
    // Aller : nul ; retour : nul → égalité 2–2, manche décisive.
    await playRound(id, 2, users, () => 'draw');
    await playRound(id, 3, users, () => 'draw');
    d = await detail(creator, id);
    expect(d.knockout[0]).toMatchObject({ firstScore: 2, secondScore: 2, winner: null, deciderNeeded: true });
    const decider = (await allMatches(id)).find((m) => m.stage === 'decider')!;
    await playRound(id, decider.round, users, () => 'home');
    const g = [...games.values()].find((x) => x.league.matchId === decider.id);
    expect(g?.clock).toEqual({ initialMs: 300_000, incrementMs: 0 });
    d = await detail(creator, id);
    expect(d.status).toBe('finished');
    // Le vainqueur de la manche décisive (blancs) rafle la cagnotte de 200.
    expect(d.medals[0]?.player.userId).toBe(decider.players[0]);
    expect(await balanceOf(t.db.pool, decider.players[0]!)).toBe(450 + 200);
  });
});

describe('Ludo', () => {
  it('tables recomposées, points par place, absent compté forfait', async () => {
    const creator = await createMember(t);
    const { id } = LeagueDetailSchema.parse(
      await req(
        creator,
        'POST',
        '/v1/leagues',
        {
          name: 'Ludo du vendredi',
          game: 'ludo',
          access: 'private',
          format: 'championship',
          maxPlaces: 12,
          entry: 0,
          rounds: 2,
          boardRules: { policy: 'rotation', allowed: ['ludo_classique', 'ludo_rapide'], defaultBoard: 'ludo_classique' },
          firstDay: '2026-11-03',
        },
        201,
      ),
    );
    const ps = [creator];
    for (let i = 0; i < 4; i++) {
      const p = await createMember(t);
      await req(p, 'POST', `/v1/leagues/${id}/join`);
      ps.push(p);
    }
    await req(creator, 'POST', `/v1/leagues/${id}/start`);
    const users = new Map<string, TestUser>(ps.map((p) => [p.userId, p]));
    const r1 = (await allMatches(id)).filter((m) => m.round === 1);
    // 5 joueurs : une table de 3 et une de 2.
    expect(r1.map((m) => m.players.length).sort()).toEqual([2, 3]);
    const absent = r1.find((m) => m.players.length === 3)!.players[2]!;
    t.clock.set(r1[0]!.match_at);
    for (const m of r1) for (const p of m.players) if (p !== absent) await req(users.get(p)!, 'POST', `/v1/leagues/${id}/matches/${m.id}/arrive`);
    t.clock.advance(11 * 60_000);
    await tick();
    for (const m of await allMatches(id)) {
      if (m.round !== 1 || !m.game_id) continue;
      const g = games.get(m.game_id)!;
      expect(g.variant).toBe('ludo_classique');
      await finished!({
        gameId: m.game_id,
        context: 'league',
        league: { leagueId: id, matchId: m.id },
        outcome: { places: Object.fromEntries(g.seats.map((_, i) => [String(i), i + 1])), draw: false, reason: 'all_home' },
        seats: g.seats.map((s, seat) => ({ seat, userId: s.userId })),
        tokensHome: Object.fromEntries(g.seats.map((_, i) => [String(i), 4 - i])),
      });
    }
    const d = await detail(creator, id);
    const row = (uid: string) => d.standings.find((r) => r.player.userId === uid)!;
    expect(row(absent)).toMatchObject({ points: 0, forfeits: 1 });
    expect(d.standings[0]?.points).toBe(4);
    // Journée 2 : planche suivante de la rotation.
    const r2 = (await allMatches(id)).filter((m) => m.round === 2);
    await playRound(id, 2, users, () => 'home');
    const v = [...games.values()].find((g) => g.league.matchId === r2.find((m) => m.status !== 'cancelled')?.id);
    expect(v?.variant ?? 'ludo_rapide').toBe('ludo_rapide');
  });

  it('seul présent à sa table : il la gagne (4 points), l’absent fait forfait', async () => {
    const creator = await createMember(t);
    const other = await createMember(t);
    const { id } = LeagueDetailSchema.parse(
      await req(
        creator,
        'POST',
        '/v1/leagues',
        {
          name: 'Ludo à deux',
          game: 'ludo',
          access: 'private',
          format: 'championship',
          maxPlaces: 4,
          entry: 0,
          rounds: 1,
          boardRules: { policy: 'imposed', allowed: ['ludo_classique'], defaultBoard: 'ludo_classique' },
          firstDay: '2026-11-03',
        },
        201,
      ),
    );
    await req(other, 'POST', `/v1/leagues/${id}/join`);
    await req(creator, 'POST', `/v1/leagues/${id}/start`);
    const [m] = await allMatches(id);
    t.clock.set(m!.match_at);
    await req(creator, 'POST', `/v1/leagues/${id}/matches/${m!.id}/arrive`);
    t.clock.advance(11 * 60_000);
    await tick();
    const d = await detail(creator, id);
    expect(d.standings.find((r) => r.player.userId === creator.userId)).toMatchObject({ points: 4, position: 1 });
    expect(d.standings.find((r) => r.player.userId === other.userId)).toMatchObject({ points: 0, forfeits: 1 });
  });
});

describe('par équipes', () => {
  function teamLeague(over: Partial<CreateLeagueRequest> = {}): CreateLeagueRequest {
    return {
      name: 'Coupe des quartiers',
      game: 'dames',
      access: 'private',
      format: 'championship',
      maxPlaces: 3,
      entry: 100,
      doubleRound: false,
      boardRules: { policy: 'imposed', allowed: ['dames10'], defaultBoard: 'dames10' },
      defaultTime: '20:00',
      rhythm: 'daily',
      firstDay: '2026-11-03',
      teamSize: 3,
      teamName: 'Les Lions',
      ...over,
    };
  }

  it('Dames à 3 : équipes, ordre du capitaine caché puis figé, 3 planches, cagnotte à l’équipe championne', async () => {
    const creator = await createMember(t);
    expect((await errorOf(creator, 'POST', '/v1/leagues', teamLeague({ teamSize: 2 }))).code).toBe('league.settings_invalid');
    expect((await errorOf(creator, 'POST', '/v1/leagues', teamLeague({ boardRules: { policy: 'home', allowed: ['dames10'], defaultBoard: 'dames10' } }))).code).toBe(
      'league.settings_invalid',
    );
    const created = LeagueDetailSchema.parse(await req(creator, 'POST', '/v1/leagues', teamLeague(), 201));
    const id = created.id;
    expect(created).toMatchObject({ teamSize: 3, myTeam: { captain: true } });
    expect(created.teams).toHaveLength(1);
    const lions = created.teams[0]!.id;

    const ps: TestMember[] = [];
    for (let i = 0; i < 8; i++) ps.push(await createMember(t));
    const [l1, l2, a1, a2, a3, solo, stray, late] = ps as [TestMember, TestMember, TestMember, TestMember, TestMember, TestMember, TestMember, TestMember];
    expect((await errorOf(stray, 'POST', `/v1/leagues/${id}/join`)).code).toBe('league.team_required');
    await req(l1, 'POST', `/v1/leagues/${id}/teams/${lions}/join`);
    await req(l2, 'POST', `/v1/leagues/${id}/teams/${lions}/join`);
    expect((await errorOf(stray, 'POST', `/v1/leagues/${id}/teams/${lions}/join`)).code).toBe('league.team_full');
    expect((await errorOf(a1, 'POST', `/v1/leagues/${id}/teams`, { name: 'les lions' })).code).toBe('league.team_name_taken');
    const withEagles = LeagueDetailSchema.parse(await req(a1, 'POST', `/v1/leagues/${id}/teams`, { name: 'Les Aigles' }, 201));
    const eagles = withEagles.teams.find((x) => x.name === 'Les Aigles')!.id;
    await req(a2, 'POST', `/v1/leagues/${id}/teams/${eagles}/join`);
    await req(a3, 'POST', `/v1/leagues/${id}/teams/${eagles}/join`);
    await req(solo, 'POST', `/v1/leagues/${id}/teams`, { name: 'Seul' }, 201);
    // Trois équipes sur trois places, aucune place libre dans une équipe… sauf chez « Seul ».
    expect((await errorOf(late, 'POST', `/v1/leagues/${id}/teams`, { name: 'Retard' })).code).toBe('league.full');
    expect(await escrowBalance(t.db.pool, potKey(id))).toBe(700);

    // Lancement : « Seul » est incomplète, elle est dissoute et son joueur remboursé.
    const started = LeagueDetailSchema.parse(await req(creator, 'POST', `/v1/leagues/${id}/start`));
    expect(started.status).toBe('running');
    expect(started.teams.map((x) => x.name).sort()).toEqual(['Les Aigles', 'Les Lions']);
    expect(await balanceOf(t.db.pool, solo.userId)).toBe(500);
    expect(await escrowBalance(t.db.pool, potKey(id))).toBe(600);
    expect(started.teamMatches).toHaveLength(1);
    const tm = started.teamMatches[0]!;
    expect(tm.boards.map((b) => b.boardNo)).toEqual([1, 2, 3]);

    // Les Aigles déposent leur ordre ; les Lions ne le voient pas avant l'heure limite.
    const users = new Map<string, TestUser>([creator, ...ps].map((p) => [p.userId, p]));
    expect((await errorOf(a2, 'POST', `/v1/leagues/${id}/team-matches/${tm.id}/lineup`, { order: [a3.userId, a1.userId, a2.userId] })).code).toBe('league.not_captain');
    expect((await errorOf(a1, 'POST', `/v1/leagues/${id}/team-matches/${tm.id}/lineup`, { order: [a3.userId, a1.userId, l1.userId] })).code).toBe('league.lineup_invalid');
    await req(a1, 'POST', `/v1/leagues/${id}/team-matches/${tm.id}/lineup`, { order: [a3.userId, a1.userId, a2.userId] });
    const side = tm.home.id === eagles ? 'home' : 'away';
    expect((await detail(a1, id)).myTeam?.nextMatch?.lineups[side]).toEqual([a3.userId, a1.userId, a2.userId]);
    expect((await detail(creator, id)).teamMatches[0]!.lineups[side]).toBeNull();
    // Pas d'heure à proposer : la rencontre se joue à l'heure de la ligue.
    expect((await errorOf(users.get(tm.boards[0]!.players[0]!.userId)!, 'POST', `/v1/leagues/${id}/matches/${tm.boards[0]!.id}/time`, { time: '18:00' })).code).toBe('league.team_match_fixed');

    // 1 h avant : ordres figés et appliqués (Lions sans ordre : l'ordre de l'équipe).
    t.clock.set(new Date(Date.parse(tm.matchAt) - 59 * 60_000));
    await tick();
    expect((await errorOf(a1, 'POST', `/v1/leagues/${id}/team-matches/${tm.id}/lineup`, { order: [a1.userId, a2.userId, a3.userId] })).code).toBe('league.too_late');
    const locked = (await detail(creator, id)).teamMatches[0]!;
    expect(locked.lineupLocked).toBe(true);
    expect(locked.lineups[side]).toEqual([a3.userId, a1.userId, a2.userId]);
    const eagleOn = (board: number) => locked.boards[board - 1]!.players.map((p) => p.userId).find((u) => [a1, a2, a3].some((a) => a.userId === u));
    expect([1, 2, 3].map(eagleOn)).toEqual([a3.userId, a1.userId, a2.userId]);
    // L'équipe qui reçoit a les blancs sur les planches 1 et 3.
    const homeIds = new Set(started.teams.find((x) => x.id === tm.home.id)!.players.map((p) => p.userId));
    expect(locked.boards.map((b) => homeIds.has(b.players[0]!.userId))).toEqual([true, false, true]);

    // Les blancs gagnent partout : l'équipe qui reçoit gagne 2 planches sur 3 (4–2).
    await playRound(id, 1, users, () => 'home');
    const d = await detail(creator, id);
    expect(d.status).toBe('finished');
    expect(d.teamStandings.map((r) => [r.team.id, r.points, r.gamesFor, r.gamesAgainst])).toEqual([
      [tm.home.id, 3, 4, 2],
      [tm.away.id, 0, 2, 4],
    ]);
    // Cagnotte de 600 : 200 pour chaque joueur de l'équipe championne.
    const champions = started.teams.find((x) => x.id === tm.home.id)!.players.map((p) => p.userId);
    const others = started.teams.find((x) => x.id === tm.away.id)!.players.map((p) => p.userId);
    for (const u of champions) expect(await balanceOf(t.db.pool, u)).toBe(600);
    for (const u of others) expect(await balanceOf(t.db.pool, u)).toBe(400);
    expect(await escrowBalance(t.db.pool, potKey(id))).toBe(0);
    expect(d.medals.filter((m) => m.kind === 'or').map((m) => m.player.userId).sort()).toEqual([...champions].sort());
    expect(d.medals.filter((m) => m.kind === 'argent')).toHaveLength(3);
  });

  it('Ludo à 2 : partenaires face à face, somme des places, une seule équipe venue gagne sans jouer', async () => {
    const creator = await createMember(t);
    const body = teamLeague({
      name: 'Ludo des familles',
      game: 'ludo',
      entry: 0,
      maxPlaces: 3,
      teamSize: 2,
      teamName: 'Rouges',
      doubleRound: true,
      boardRules: { policy: 'imposed', allowed: ['ludo_classique'], defaultBoard: 'ludo_classique' },
    });
    expect((await errorOf(creator, 'POST', '/v1/leagues', { ...body, boardRules: { policy: 'imposed', allowed: ['ludo_six'], defaultBoard: 'ludo_six' } })).code).toBe(
      'league.settings_invalid',
    );
    const { id, teams } = LeagueDetailSchema.parse(await req(creator, 'POST', '/v1/leagues', body, 201));
    const [r2, b1, b2] = [await createMember(t), await createMember(t), await createMember(t)];
    await req(r2, 'POST', `/v1/leagues/${id}/teams/${teams[0]!.id}/join`);
    const withBlue = LeagueDetailSchema.parse(await req(b1, 'POST', `/v1/leagues/${id}/teams`, { name: 'Bleus' }, 201));
    await req(b2, 'POST', `/v1/leagues/${id}/teams/${withBlue.teams.find((x) => x.name === 'Bleus')!.id}/join`);
    await req(creator, 'POST', `/v1/leagues/${id}/start`);
    const users = new Map<string, TestUser>([creator, r2, b1, b2].map((p) => [p.userId, p]));

    // Journée 1 : une table de 4, les deux équipes face à face.
    const [table] = (await allMatches(id)).filter((m) => m.round === 1);
    expect(table!.players).toHaveLength(4);
    t.clock.set(table!.match_at);
    for (const p of table!.players) await req(users.get(p)!, 'POST', `/v1/leagues/${id}/matches/${table!.id}/arrive`);
    const gameId = (await allMatches(id)).find((m) => m.id === table!.id)!.game_id!;
    const g = games.get(gameId)!;
    expect(g.teams).toEqual([
      [0, 2],
      [1, 3],
    ]);
    // Places : 1, 2, 4, 3 → l'équipe des sièges 0 et 2 fait 5, l'autre 5 : le premier départage.
    await finished!({
      gameId,
      context: 'league',
      league: { leagueId: id, matchId: table!.id },
      outcome: { places: { 0: 1, 1: 2, 2: 4, 3: 3 }, draw: false, reason: 'team_home' },
      seats: g.seats.map((s, seat) => ({ seat, userId: s.userId })),
      tokensHome: { 0: 4, 1: 3, 2: 1, 3: 2 },
    });
    let d = await detail(creator, id);
    const homeTeam = d.teams.find((x) => x.players.some((p) => p.userId === table!.players[0]))!;
    expect(d.teamStandings[0]).toMatchObject({ team: { id: homeTeam.id }, points: 3, wins: 1, gamesFor: 5, gamesAgainst: 5 });

    // Journée 2 (retour) : seule l'équipe qui reçoit vient ; elle gagne sans jouer.
    const [back] = (await allMatches(id)).filter((m) => m.round === 2);
    t.clock.set(back!.match_at);
    for (const p of [back!.players[0]!, back!.players[2]!]) await req(users.get(p)!, 'POST', `/v1/leagues/${id}/matches/${back!.id}/arrive`);
    t.clock.advance(11 * 60_000);
    await tick();
    expect((await allMatches(id)).find((m) => m.id === back!.id)!.game_id).toBeNull();
    d = await detail(creator, id);
    expect(d.status).toBe('finished');
    const backHome = d.teams.find((x) => x.players.some((p) => p.userId === back!.players[0]))!;
    expect(d.teamStandings.find((r) => r.team.id === backHome.id)).toMatchObject({ wins: 1 });
    expect(d.medals).toHaveLength(4);
  });
});
