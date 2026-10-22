import {
  ERROR_CODES,
  HOUSE_RULE_SETS_MAX,
  HouseRuleSetListSchema,
  HouseRuleSetSchema,
  LUDO_BARRIER_RULES,
  LUDO_CAPTURE_RULES,
  LUDO_EXIT_RULES,
  LUDO_PRESETS,
  LUDO_PROTECTION_RULES,
  type HouseRuleSet,
} from '@kwatt/protocol';
import { HOUSE_OPTIONS, isRanked, LUDO_ERRORS, PRESET_IDS, type BarrierRule, type CaptureRule, type ExitRule, type Preset, type ProtectionRule } from '@kwatt/rules-ludo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createGuest, createMember, type TestApp, type TestMember } from '../../test/helpers.js';
import { checkHouseRules, loadHouseRuleSet } from './service.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'ludo' });
});
afterAll(async () => {
  await t.close();
});

const url = '/v1/ludo/house-rules';

async function create(m: TestMember, payload: object) {
  return t.app.inject({ method: 'POST', url, headers: m.headers, payload });
}

async function createOk(m: TestMember, payload: object): Promise<HouseRuleSet> {
  const res = await create(m, payload);
  expect(res.statusCode, res.body).toBe(201);
  return HouseRuleSetSchema.parse(res.json());
}

describe('protocole et règles du Ludo alignés', () => {
  it('les codes de @kwatt/rules-ludo sont tous dans ERROR_CODES', () => {
    for (const code of LUDO_ERRORS) expect(ERROR_CODES).toContain(code);
  });

  it('les valeurs des schémas reprennent celles de @kwatt/rules-ludo', () => {
    expect([...LUDO_PRESETS].sort()).toEqual([...PRESET_IDS].sort());
    const all = <T extends string>(pick: (o: (typeof HOUSE_OPTIONS)['croix']) => T[]): T[] =>
      [...new Set(Object.values(HOUSE_OPTIONS).flatMap(pick))].sort();
    expect(all((o) => o.exit)).toEqual([...LUDO_EXIT_RULES].sort());
    expect(all((o) => o.capture)).toEqual([...LUDO_CAPTURE_RULES].sort());
    expect(all((o) => o.protection)).toEqual([...LUDO_PROTECTION_RULES].sort());
    expect(all((o) => o.barriers)).toEqual([...LUDO_BARRIER_RULES].sort());
    // Les types sont les mêmes (vérification à la compilation).
    const typed: [Preset, ExitRule, CaptureRule, ProtectionRule, BarrierRule] = [LUDO_PRESETS[0], LUDO_EXIT_RULES[0], LUDO_CAPTURE_RULES[0], LUDO_PROTECTION_RULES[0], LUDO_BARRIER_RULES[0]];
    expect(typed).toHaveLength(5);
  });
});

describe('checkHouseRules', () => {
  it('ne garde que ce qui diffère de la variante', () => {
    expect(checkHouseRules('classique', { exit: 'six', capture: 'home_roll_again' })).toEqual({ capture: 'home_roll_again' });
  });

  it('refuse les combinaisons bloquées avec le code des règles', () => {
    expect(() => checkHouseRules('classique', { barriers: 'any' })).toThrow('ludo.setup.barrier_lock');
    expect(() => checkHouseRules('classique', { exit: 'grace' })).toThrow('ludo.setup.throw_incompatible');
    expect(() => checkHouseRules('pachisi', { exit: 'six' })).toThrow('ludo.setup.throw_incompatible');
    expect(() => checkHouseRules('classique', { protection: 'chateaux' })).toThrow('ludo.setup.house_option');
  });

  it('refuse des règles identiques à la variante', () => {
    expect(() => checkHouseRules('rapide', { exit: 'six_or_one' })).toThrow('ludo.house_rules.empty');
  });

  it('une partie aux règles maison est amicale', () => {
    const house = checkHouseRules('classique', { capture: 'home_bonus20' });
    expect(isRanked({ preset: 'classique', house })).toBe(false);
    expect(isRanked({ preset: 'classique', house: null })).toBe(true);
  });
});

describe('/v1/ludo/house-rules', () => {
  it('crée, liste, lit, modifie et supprime un jeu de règles', async () => {
    const m = await createMember(t);
    const created = await createOk(m, { name: '  Les règles de Tata Odile ', preset: 'classique', rules: { exit: 'six_or_one', barriers: 'six_opens' } });
    expect(created.name).toBe('Les règles de Tata Odile');
    expect(created.rules).toEqual({ exit: 'six_or_one', barriers: 'six_opens' });

    const list = await t.app.inject({ method: 'GET', url, headers: m.headers });
    expect(list.statusCode).toBe(200);
    expect(HouseRuleSetListSchema.parse(list.json()).items.map((s) => s.id)).toEqual([created.id]);

    const one = await t.app.inject({ method: 'GET', url: `${url}/${created.id}`, headers: m.headers });
    expect(HouseRuleSetSchema.parse(one.json()).preset).toBe('classique');

    const upd = await t.app.inject({ method: 'PUT', url: `${url}/${created.id}`, headers: m.headers, payload: { name: 'Chez Tata', rules: { capture: 'home_roll_again' } } });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(HouseRuleSetSchema.parse(upd.json())).toMatchObject({ name: 'Chez Tata', rules: { capture: 'home_roll_again' } });

    const del = await t.app.inject({ method: 'DELETE', url: `${url}/${created.id}`, headers: m.headers });
    expect(del.json()).toEqual({ ok: true });
    const gone = await t.app.inject({ method: 'GET', url: `${url}/${created.id}`, headers: m.headers });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe('ludo.house_rules.not_found');
  });

  it('refuse une combinaison bloquée (422, code des règles)', async () => {
    const m = await createMember(t);
    const res = await create(m, { name: 'Bloqué', preset: 'classique', rules: { barriers: 'any' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ludo.setup.barrier_lock');
    const parchis = await create(m, { name: 'Parchís à la grâce', preset: 'parchis', rules: { exit: 'grace' } });
    expect(parchis.json().error.code).toBe('ludo.setup.throw_incompatible');
  });

  it('refuse des règles sans changement et une valeur inconnue', async () => {
    const m = await createMember(t);
    const same = await create(m, { name: 'Rien', preset: 'classique', rules: { exit: 'six' } });
    expect(same.statusCode).toBe(422);
    expect(same.json().error.code).toBe('ludo.house_rules.empty');
    const bad = await create(m, { name: 'Bizarre', preset: 'classique', rules: { exit: 'seven' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('common.validation');
  });

  it('un nom par joueur, sans tenir compte de la casse', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    await createOk(a, { name: 'Maison', preset: 'six', rules: { capture: 'home_roll_again' } });
    const dup = await create(a, { name: 'MAISON', preset: 'classique', rules: { capture: 'home_roll_again' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('ludo.house_rules.name_taken');
    // Un autre joueur peut prendre le même nom.
    await createOk(b, { name: 'Maison', preset: 'classique', rules: { capture: 'home_roll_again' } });
  });

  it("le jeu de règles d'un autre joueur n'existe pas pour lui", async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const set = await createOk(a, { name: 'Secret', preset: 'pachisi', rules: { barriers: 'none' } });
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await t.app.inject({ method, url: `${url}/${set.id}`, headers: b.headers });
      expect(res.statusCode).toBe(404);
    }
    const put = await t.app.inject({ method: 'PUT', url: `${url}/${set.id}`, headers: b.headers, payload: { name: 'Volé' } });
    expect(put.statusCode).toBe(404);
    await expect(loadHouseRuleSet(t.db.pool, a.userId, set.id)).resolves.toMatchObject({ name: 'Secret' });
  });

  it('changer de variante revérifie les règles', async () => {
    const m = await createMember(t);
    const set = await createOk(m, { name: 'Barrières', preset: 'classique', rules: { exit: 'six_or_one', barriers: 'any' } });
    // Sur le Pachisi, la sortie au 6 ou au 1 n'existe pas (cauris).
    const res = await t.app.inject({ method: 'PUT', url: `${url}/${set.id}`, headers: m.headers, payload: { preset: 'pachisi' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ludo.setup.throw_incompatible');
  });

  it(`limite de ${HOUSE_RULE_SETS_MAX} jeux de règles par joueur`, async () => {
    const m = await createMember(t);
    for (let i = 0; i < HOUSE_RULE_SETS_MAX; i++) await createOk(m, { name: `Règles ${i}`, preset: 'classique', rules: { capture: 'home_roll_again' } });
    const res = await create(m, { name: 'Une de trop', preset: 'classique', rules: { capture: 'home_roll_again' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: 'ludo.house_rules.limit', params: { max: HOUSE_RULE_SETS_MAX } });
  });

  it('réservé aux profils', async () => {
    const g = await createGuest(t);
    const res = await t.app.inject({ method: 'GET', url, headers: g.headers });
    expect(res.statusCode).toBe(403);
    const anon = await t.app.inject({ method: 'GET', url });
    expect(anon.statusCode).toBe(401);
  });
});
