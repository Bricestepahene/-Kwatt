import { chooseMoveSync } from '@kwatt/engine-dames';
import {
  MachineOffersResponseSchema,
  MachineResultResponseSchema,
  type MachineOffersResponse,
  type MachineResultRequest,
  type MachineResultResponse,
} from '@kwatt/protocol';
import { applyMove, initialState, legalMoves, toNotation, type Variant } from '@kwatt/rules-dames';
import { applyMove as ludoMove, applyRoll, legalMoves as ludoLegal, newGame } from '@kwatt/rules-ludo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createMember, uniq, type TestApp, type TestMember } from '../../test/helpers.js';
import { lockStake } from '../economy/escrow.js';
import { balanceOf } from '../economy/ledger.js';
import { replayDames } from './replay.js';
import { settleMachineOnline } from './service.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'machine' });
});
afterAll(async () => {
  await t.close();
});

async function offers(m: TestMember, query = 'family=dames&variant=dames10'): Promise<MachineOffersResponse> {
  const res = await t.app.inject({ method: 'GET', url: `/v1/machine/offers?${query}`, headers: m.headers });
  expect(res.statusCode).toBe(200);
  return MachineOffersResponseSchema.parse(res.json());
}

function send(m: TestMember, body: MachineResultRequest) {
  return t.app.inject({ method: 'POST', url: '/v1/machine/results', headers: m.headers, payload: body });
}

async function result(m: TestMember, body: MachineResultRequest): Promise<MachineResultResponse> {
  const res = await send(m, body);
  expect(res.statusCode, res.body).toBe(200);
  return MachineResultResponseSchema.parse(res.json());
}

/**
 * Partie de dames contre la machine, comme l'appli la joue : le joueur (blancs) choisit
 * avec le moteur à pleine force (petit budget), la machine avec la force visée et la graine.
 */
function damesGame(variant: Variant, targetRating: number, seed: number): string[] {
  let s = initialState(variant);
  const moves: string[] = [];
  while (!s.result && moves.length < 400) {
    const c = s.turn === 'w' ? chooseMoveSync(s, { maxNodes: 20_000, seed: 7 }) : chooseMoveSync(s, { targetRating, seed });
    moves.push(toNotation(c.move));
    s = applyMove(s, c.move);
  }
  return moves;
}

function request(over: Partial<MachineResultRequest> & Pick<MachineResultRequest, 'moves'>): MachineResultRequest {
  return {
    clientGameId: `local-${uniq()}`,
    family: 'dames',
    variant: 'dames8',
    difficulty: 'facile',
    mode: 'chosen',
    seed: 42,
    playedAt: new Date(t.clock.now().getTime() - 60_000).toISOString(),
    ...over,
  };
}

describe('GET /v1/machine/offers', () => {
  it('cinq difficultés relatives à la force, Fon verrouillé avant Chef, plafond de pari', async () => {
    const m = await createMember(t, { verified: true });
    const o = await offers(m);
    expect(o.rating).toBe(900);
    expect(o.rank).toBe('apprenti');
    expect(o.difficulties.map((d) => [d.id, d.oddsHundredths, d.baseReward, d.unlocked])).toEqual([
      ['facile', 100, 25, true],
      ['moyen', 120, 25, true],
      ['coriace', 150, 40, true],
      ['ton_niveau', 180, 60, true],
      ['fon', 450, 100, false],
    ]);
    expect(o.difficulties.find((d) => d.id === 'ton_niveau')!.machineRating).toBe(900);
    expect(o.auto).toEqual({ difficulty: 'ton_niveau', streak: 0 });
    expect(o).toMatchObject({ winStreak: 0, rewardedToday: 0, dailyLimit: 10, betCap: 100 });
  });

  it('pas de pari sans adresse vérifiée ; Ludo à 3 machines : chance plus faible, cote plus haute', async () => {
    const m = await createMember(t);
    expect((await offers(m)).betCap).toBe(0);
    const ludo = await offers(m, 'family=ludo&variant=ludo_classique&machines=3');
    const level = ludo.difficulties.find((d) => d.id === 'ton_niveau')!;
    expect(level.p).toBe(0.25);
    expect(level.oddsHundredths).toBe(360);
  });

  it('refuse une variante d’un autre jeu', async () => {
    const m = await createMember(t);
    const res = await t.app.inject({ method: 'GET', url: '/v1/machine/offers?family=dames&variant=ludo_six', headers: m.headers });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('machine.invalid_variant');
  });
});

describe('POST /v1/machine/results (hors connexion)', () => {
  it('rejoue la partie, paie la victoire, met la force à jour et rend la même réponse au renvoi', async () => {
    const m = await createMember(t);
    const o = await offers(m, 'family=dames&variant=dames8');
    const target = o.difficulties.find((d) => d.id === 'facile')!.machineRating;
    const moves = damesGame('dames8', target, 42);
    expect(replayDames('dames8', moves, { targetRating: target, seed: 42 }).outcome).toBe('win');
    const body = request({ moves, machineRating: target });
    const r = await result(m, body);
    expect(r.outcome).toBe('win');
    expect(r.settlement).toEqual({ net: 25, base: 25, participation: 0, betNet: 0, streakBonus: false, counted: true });
    expect(r.rating?.before).toBe(900);
    expect(r.rating!.delta).toBeGreaterThan(0);
    expect(r.winStreak).toBe(1);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(525);

    // Renvoi (réseau revenu deux fois) : rien n'est recompté.
    expect(await result(m, body)).toEqual(r);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(525);
    // Même identifiant, autre contenu : conflit.
    const conflict = await send(m, { ...body, moves: [] });
    expect(conflict.statusCode).toBe(409);

    // La partie apparaît dans les derniers matchs du profil (games + game_players).
    const g = await t.db.pool.query(`SELECT g.context, g.status, gp.result FROM games g JOIN game_players gp ON gp.game_id = g.id WHERE gp.user_id = $1`, [
      m.userId,
    ]);
    expect(g.rows).toEqual([{ context: 'machine', status: 'finished', result: 'win' }]);
  });

  it('refuse un coup de machine différent de celui que le moteur joue', async () => {
    const m = await createMember(t);
    const target = (await offers(m, 'family=dames&variant=dames8')).difficulties[0]!.machineRating;
    const moves = damesGame('dames8', target, 9);
    // On remplace la première réponse de la machine par un autre coup légal.
    let s = initialState('dames8');
    const forged = [...moves];
    for (const [i, text] of moves.entries()) {
      const legal = legalMoves(s);
      if (s.turn === 'b' && legal.length > 1) {
        const other = legal.find((mv) => toNotation(mv) !== text)!;
        forged[i] = toNotation(other);
        forged.length = i + 1;
        break;
      }
      s = applyMove(s, legal.find((mv) => toNotation(mv) === text)!);
    }
    const res = await send(m, request({ moves: forged, machineRating: target, seed: 9 }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'machine.invalid_game', params: { reason: 'machine_mismatch' } });
  });

  it('refuse un coup illégal du joueur et une force visée trop éloignée de l’offre', async () => {
    const m = await createMember(t);
    const illegal = await send(m, request({ moves: ['9-14'] }));
    expect(illegal.statusCode).toBe(422);
    const far = await send(m, request({ moves: [], machineRating: 2000 }));
    expect(far.statusCode).toBe(422);
    expect(far.json().error.code).toBe('machine.rating_mismatch');
  });

  it('abandon : défaite, +10 de participation ; 10 parties récompensées par jour', async () => {
    const m = await createMember(t);
    for (let i = 0; i < 10; i++) {
      const r = await result(m, request({ moves: [] }));
      expect(r.outcome).toBe('loss');
      expect(r.settlement).toMatchObject({ net: 10, participation: 10, counted: true });
    }
    const eleventh = await result(m, request({ moves: [] }));
    expect(eleventh.settlement).toEqual({ net: 0, base: 0, participation: 0, betNet: 0, streakBonus: false, counted: false });
    expect((await offers(m)).rewardedToday).toBe(10);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(600);
  });

  it('difficulté auto : un cran de moins après 3 défaites ; série ×1,5 après 3 victoires', async () => {
    const m = await createMember(t);
    let last: MachineResultResponse | null = null;
    for (let i = 0; i < 3; i++) last = await result(m, request({ moves: [], mode: 'auto', difficulty: 'ton_niveau' }));
    expect(last!.auto).toEqual({ difficulty: 'coriace', streak: 0 });

    const target = (await offers(m, 'family=dames&variant=dames8')).difficulties[0]!.machineRating;
    const wins: MachineResultResponse[] = [];
    for (let i = 0; i < 4; i++) {
      // La force du joueur monte à chaque victoire : la machine « facile » suit l'offre du moment.
      const now = (await offers(m, 'family=dames&variant=dames8')).difficulties[0]!.machineRating;
      const moves = damesGame('dames8', now, 100 + i);
      wins.push(await result(m, request({ moves, machineRating: now, seed: 100 + i })));
    }
    expect(target).toBeGreaterThan(0);
    expect(wins.map((w) => w.outcome)).toEqual(['win', 'win', 'win', 'win']);
    expect(wins.map((w) => w.settlement.base)).toEqual([25, 25, 25, 37]);
    expect(wins[3]!.settlement.streakBonus).toBe(true);
    expect(wins[3]!.winStreak).toBe(4);
  });

  it('Ludo : légalité des lancers et des coups, place du joueur', async () => {
    const m = await createMember(t);
    // Partie simulée : lancers d'un générateur fixe, chacun joue son premier coup légal.
    let state = newGame({ preset: 'classique', players: 2 });
    let seed = 12345;
    const roll = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return ((seed >>> 16) % 6) + 1;
    };
    const moves: string[] = [];
    while (state.phase !== 'over' && moves.length < 1900) {
      const v = roll();
      state = applyRoll(state, v);
      if (state.phase === 'move') {
        const mv = ludoLegal(state)[0]!;
        moves.push(`${v}:${mv.token}`);
        state = ludoMove(state, { token: mv.token });
      } else moves.push(`${v}:-`);
    }
    expect(state.phase).toBe('over');
    const r = await result(m, request({ family: 'ludo', variant: 'ludo_classique', machines: 1, moves }));
    expect(r.outcome).toBe(state.ranking[0] === 0 ? 'win' : 'loss');
    expect(r.rating).not.toBeNull();

    const bad = await send(m, request({ family: 'ludo', variant: 'ludo_classique', machines: 1, moves: ['3:0'] }));
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('machine.invalid_game');
  });
});

describe('settleMachineOnline (partie en ligne avec pari)', () => {
  async function onlineGame(m: TestMember, bet: number): Promise<string> {
    const g = await t.db.pool.query<{ id: string }>(
      `INSERT INTO games (context, variant, rules, rules_version, ranked, status) VALUES ('machine', 'dames10', '{}', 'test', true, 'finished') RETURNING id`,
    );
    const gameId = g.rows[0]!.id;
    if (bet > 0) await lockStake(t.db.pool, gameId, { userId: m.userId, amount: bet });
    return gameId;
  }

  it('victoire : mise rendue + gain net du pari + gain de base ; idempotent', async () => {
    const m = await createMember(t);
    const gameId = await onlineGame(m, 100);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(400);
    const input = { userId: m.userId, gameId, family: 'dames' as const, variant: 'dames10', difficulty: 'ton_niveau' as const, mode: 'chosen' as const, bet: 100, outcome: 'win' as const };
    const r = await settleMachineOnline(t.db.pool, input);
    expect(r.settlement).toEqual({ net: 140, base: 60, participation: 0, betNet: 80, streakBonus: false, counted: true });
    expect(await balanceOf(t.db.pool, m.userId)).toBe(640);
    expect(await settleMachineOnline(t.db.pool, input)).toEqual(r);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(640);
  });

  it('défaite : la mise va à la maison, +10 de participation ; nulle : mise rendue', async () => {
    const m = await createMember(t);
    const lost = await onlineGame(m, 200);
    const base = { userId: m.userId, family: 'dames' as const, variant: 'dames10', difficulty: 'ton_niveau' as const, mode: 'chosen' as const, bet: 200 };
    const r = await settleMachineOnline(t.db.pool, { ...base, gameId: lost, outcome: 'loss' });
    expect(r.settlement.net).toBe(-190);
    expect(await balanceOf(t.db.pool, m.userId)).toBe(310);
    const drawn = await onlineGame(m, 50);
    await settleMachineOnline(t.db.pool, { ...base, bet: 50, gameId: drawn, outcome: 'draw' });
    expect(await balanceOf(t.db.pool, m.userId)).toBe(320);
  });
});
