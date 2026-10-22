import {
  DisplayNameResponseSchema,
  MyQuarterResponseSchema,
  QuarterListResponseSchema,
  QuarterSchema,
  type AuthSessionResponse,
} from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY } from '../../lib/clock.js';
import { buildTestApp, createGuest, createMember, type TestApp, type TestMember, type TestUser } from '../../test/helpers.js';
import { eraseUser } from '../me/service.js';
import { checkDisplayName, displayNameAsPseudo } from './display-name.js';
import { nextQuarterChangeAt, normalizeSearch } from './quarters.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'accounts' });
});
afterAll(async () => {
  await t.close();
});

type Headers = Pick<TestUser, 'headers'>;

function call(method: 'GET' | 'PUT', url: string, user: Headers | null, payload?: unknown) {
  return t.app.inject({ method, url, headers: user?.headers ?? {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
}

async function search(user: Headers, query: string) {
  const res = await call('GET', `/v1/quarters${query}`, user);
  expect(res.statusCode, res.body).toBe(200);
  return QuarterListResponseSchema.parse(res.json()).items;
}

/** Nouvelle connexion (le jeton d'accès expire quand l'horloge avance). */
async function relogin(m: TestMember): Promise<Headers> {
  const res = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login: m.email, password: m.password, device: m.device } });
  expect(res.statusCode, res.body).toBe(200);
  return { headers: { authorization: `Bearer ${res.json<AuthSessionResponse>().accessToken}` } };
}

describe('outils purs', () => {
  it('normalise une recherche comme la colonne search_key', () => {
    expect(normalizeSearch('  Deïdo ')).toBe('deido');
    expect(normalizeSearch("N'Djamena")).toBe('n djamena');
    expect(normalizeSearch('ÉBOLOWA')).toBe('ebolowa');
    expect(normalizeSearch('Mvog-Ada  %_')).toBe('mvog ada');
  });

  it('un changement de quartier par saison (mois civil, heure du Cameroun)', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    expect(nextQuarterChangeAt(null, now)).toBeNull();
    expect(nextQuarterChangeAt(new Date('2026-02-27T10:00:00Z'), now)).toBeNull();
    // Saison de mars : jusqu'au 1er avril, minuit à Douala (23 h UTC le 31 mars).
    expect(nextQuarterChangeAt(new Date('2026-03-01T08:00:00Z'), now)?.toISOString()).toBe('2026-03-31T23:00:00.000Z');
    // 28 février, 23 h 30 UTC = 1er mars, 0 h 30 à Douala : déjà la saison de mars.
    expect(nextQuarterChangeAt(new Date('2026-02-28T23:30:00Z'), now)?.toISOString()).toBe('2026-03-31T23:00:00.000Z');
  });

  it('vérifie le nom de partie (forme, mots interdits)', () => {
    expect(checkDisplayName('  Tonton   Paul ')).toEqual({ name: 'Tonton Paul', problem: null });
    expect(checkDisplayName('Mamá Ngo-Bassa').problem).toBeNull();
    expect(checkDisplayName("Tata O'dile").problem).toBeNull();
    expect(checkDisplayName('A').problem).toBe('invalid');
    expect(checkDisplayName('x'.repeat(21)).problem).toBe('invalid');
    expect(checkDisplayName('Paul!').problem).toBe('invalid');
    expect(checkDisplayName('  ').problem).toBe('invalid');
    expect(checkDisplayName('Kwatt Officiel').problem).toBe('banned');
    expect(checkDisplayName('Le Con').problem).toBe('banned');
    expect(displayNameAsPseudo('Ékié Mvondo')).toBe('ekie_mvondo');
  });
});

describe('GET /v1/quarters', () => {
  it('cherche sans tenir compte des accents ni des capitales', async () => {
    const g = await createGuest(t);
    expect((await search(g, '?q=deido')).map((q) => q.id)).toContain('cm-douala-deido');
    expect((await search(g, '?q=NGAOUNDERE'))[0]).toMatchObject({ id: 'cm-ngaoundere', city: 'Ngaoundéré', name: null });
    expect((await search(g, '?q=ndjamena'))[0]?.id).toBe('td-ndjamena');
    expect((await search(g, '?q=london'))[0]).toMatchObject({ id: 'gb-londres', city: 'Londres', cityEn: 'London', country: 'GB' });
    expect(await search(g, '?q=zzzz')).toEqual([]);
  });

  it('met les débuts de nom devant, filtre par pays, borne le nombre', async () => {
    const g = await createGuest(t);
    const bona = await search(g, '?q=bona');
    expect(bona.slice(0, 5).map((q) => q.name)).toEqual(['Bonabéri', 'Bonadibong', 'Bonamoussadi', 'Bonanjo', 'Bonapriso']);
    const douala = await search(g, '?q=douala&limit=50');
    // La ville seule (« autre quartier ») avant ses quartiers.
    expect(douala[0]).toMatchObject({ id: 'cm-douala', name: null });
    expect(douala.length).toBeGreaterThan(30);
    const fr = await search(g, '?country=FR&limit=50');
    expect(fr.length).toBeGreaterThan(5);
    expect(fr.every((q) => q.country === 'FR' && q.name === null)).toBe(true);
    expect(await search(g, '?limit=3')).toHaveLength(3);
  });

  it('sans texte : les quartiers les plus peuplés, puis les villes du Cameroun', async () => {
    const g = await createGuest(t);
    const m = await createMember(t);
    await call('PUT', '/v1/me/quarter', m, { quarterId: 'cm-yaounde-bastos' });
    const list = await search(g, '?limit=10');
    expect(list[0]).toMatchObject({ id: 'cm-yaounde-bastos', players: 1 });
    expect(list.slice(1).every((q) => q.country === 'CM' && q.name === null)).toBe(true);
  });

  it('demande une session et une requête valide', async () => {
    expect((await call('GET', '/v1/quarters', null)).statusCode).toBe(401);
    const g = await createGuest(t);
    const bad = await call('GET', '/v1/quarters?limit=0', g);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('common.validation');
  });

  it('un quartier par son identifiant', async () => {
    const g = await createGuest(t);
    const res = await call('GET', '/v1/quarters/cm-douala-bonamoussadi', g);
    expect(res.statusCode).toBe(200);
    expect(QuarterSchema.parse(res.json())).toMatchObject({ city: 'Douala', name: 'Bonamoussadi', country: 'CM' });
    const unknown = await call('GET', '/v1/quarters/cm-douala-nulle-part', g);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('quarter.not_found');
    expect((await call('GET', '/v1/quarters/PAS_UN_ID', g)).statusCode).toBe(400);
  });
});

describe('quartier du joueur', () => {
  it('premier choix libre, puis un changement par saison', async () => {
    t.clock.set(new Date('2026-03-10T12:00:00Z'));
    const m = await createMember(t);

    const empty = MyQuarterResponseSchema.parse((await call('GET', '/v1/me/quarter', m)).json());
    expect(empty).toEqual({ quarter: null, since: null, nextChangeAt: null, season: '2026-03' });

    const first = await call('PUT', '/v1/me/quarter', m, { quarterId: 'cm-douala-bonamoussadi' });
    expect(first.statusCode, first.body).toBe(200);
    expect(MyQuarterResponseSchema.parse(first.json())).toMatchObject({
      quarter: { id: 'cm-douala-bonamoussadi', players: 1 },
      since: '2026-03-10T12:00:00.000Z',
      nextChangeAt: null,
    });

    // Même quartier : rien ne change, ce n'est pas un changement.
    const same = await call('PUT', '/v1/me/quarter', m, { quarterId: 'cm-douala-bonamoussadi' });
    expect(same.json().nextChangeAt).toBeNull();

    t.clock.advance(60_000);
    const change = await call('PUT', '/v1/me/quarter', m, { quarterId: 'cm-douala-akwa' });
    expect(change.statusCode).toBe(200);
    expect(change.json()).toMatchObject({ quarter: { id: 'cm-douala-akwa' }, nextChangeAt: '2026-03-31T23:00:00.000Z' });

    const again = await call('PUT', '/v1/me/quarter', m, { quarterId: 'cm-douala-makepe' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toEqual({ code: 'quarter.change_too_soon', params: { nextChangeAt: '2026-03-31T23:00:00.000Z' } });
    expect((await call('GET', '/v1/me/quarter', m)).json().quarter.id).toBe('cm-douala-akwa');

    // Saison suivante (1er avril à Douala) : de nouveau possible.
    t.clock.set(new Date('2026-03-31T23:00:00Z'));
    const fresh = await relogin(m);
    const april = await call('PUT', '/v1/me/quarter', fresh, { quarterId: 'cm-douala-makepe' });
    expect(april.statusCode, april.body).toBe(200);
    expect(april.json()).toMatchObject({ season: '2026-04', nextChangeAt: '2026-04-30T23:00:00.000Z' });
    t.clock.set(new Date());
  });

  it('refuse un quartier inconnu ou retiré, et les invités', async () => {
    const m = await createMember(t);
    const unknown = await call('PUT', '/v1/me/quarter', m, { quarterId: 'cm-douala-nulle-part' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('quarter.not_found');

    await t.db.pool.query("INSERT INTO quarters (id, country, city, name, active) VALUES ('cm-douala-ancien-quartier', 'CM', 'Douala', 'Ancien quartier', false)");
    expect((await call('PUT', '/v1/me/quarter', m, { quarterId: 'cm-douala-ancien-quartier' })).statusCode).toBe(404);
    expect((await search(m, '?q=ancien quartier')).length).toBe(0);

    const g = await createGuest(t);
    const guest = await call('PUT', '/v1/me/quarter', g, { quarterId: 'cm-douala-akwa' });
    expect(guest.statusCode).toBe(403);
    expect(guest.json().error.code).toBe('auth.member_required');
    expect((await call('GET', '/v1/me/quarter', g)).statusCode).toBe(403);
  });
});

describe('nom de partie', () => {
  it('un invité donne son nom pour la partie', async () => {
    const g = await createGuest(t);
    expect(DisplayNameResponseSchema.parse((await call('GET', '/v1/me/display-name', g)).json())).toEqual({ displayName: null });
    const res = await call('PUT', '/v1/me/display-name', g, { displayName: '  Tonton   Paul ' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ displayName: 'Tonton Paul' });
    expect((await call('GET', '/v1/me/display-name', g)).json()).toEqual({ displayName: 'Tonton Paul' });

    // Reprise de l'invité de l'appareil (jetons perdus) : le nom est gardé.
    const again = await createGuest(t, g.device);
    expect(again.userId).toBe(g.userId);
    expect((await call('GET', '/v1/me/display-name', again)).json()).toEqual({ displayName: 'Tonton Paul' });
  });

  it('refuse un nom mal formé ou interdit', async () => {
    const g = await createGuest(t);
    const short = await call('PUT', '/v1/me/display-name', g, { displayName: 'P' });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('account.display_name_invalid');
    const banned = await call('PUT', '/v1/me/display-name', g, { displayName: 'Admin Kwatt' });
    expect(banned.json().error.code).toBe('account.display_name_banned');
    expect((await call('PUT', '/v1/me/display-name', null, { displayName: 'Paul' })).statusCode).toBe(401);
  });

  it('effacé avec le compte ; quartier et nom dans l\'export', async () => {
    const g = await createGuest(t);
    await call('PUT', '/v1/me/display-name', g, { displayName: 'Mami Nyanga' });
    const m = await createMember(t, { fromGuest: g });
    expect(m.userId).toBe(g.userId);
    await call('PUT', '/v1/me/quarter', m, { quarterId: 'cm-buea-molyko' });

    const exported = await call('GET', '/v1/me/export', m);
    expect(exported.statusCode).toBe(200);
    expect(exported.json().sections.quarter).toMatchObject({ id: 'cm-buea-molyko', city: 'Buea', name: 'Molyko', country: 'CM' });
    expect(exported.json().sections.displayName).toBe('Mami Nyanga');

    await eraseUser(t.db.pool, t.app.accounts, m.userId, new Date(Date.now() + 31 * DAY));
    const r = await t.db.pool.query('SELECT display_name FROM users WHERE id = $1', [m.userId]);
    expect(r.rows[0]).toEqual({ display_name: null });
    const left = await t.db.pool.query("SELECT count(*)::int AS n FROM profiles WHERE quarter = 'cm-buea-molyko'");
    expect(left.rows[0]).toEqual({ n: 0 });
  });
});
