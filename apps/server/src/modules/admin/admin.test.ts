import { WELCOME_BONUS } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createGuest, createMember, type TestApp } from '../../test/helpers.js';
import { balanceOf } from '../economy/ledger.js';
import { findUsers, resolveUserId } from './service.js';

const ADMIN_TOKEN = 'admin-token-de-test-0123456789abcdefghijkl';

let t: TestApp;
let closed: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'admin', env: { ADMIN_TOKEN } });
  closed = await buildTestApp({ suite: 'admin_off' });
});
afterAll(async () => {
  await t.close();
  await closed.close();
});

const admin = { authorization: `Bearer ${ADMIN_TOKEN}` };

function call(method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = admin) {
  return t.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
}

describe('accès', () => {
  it('sans ADMIN_TOKEN, les routes n\'existent pas', async () => {
    const res = await closed.app.inject({ method: 'GET', url: '/v1/admin/stats', headers: admin });
    expect(res.statusCode).toBe(404);
  });

  it('un mauvais jeton (ou un jeton de joueur) est refusé', async () => {
    const m = await createMember(t);
    expect((await call('GET', '/v1/admin/stats', undefined, {})).statusCode).toBe(403);
    expect((await call('GET', '/v1/admin/stats', undefined, { authorization: 'Bearer pas-le-bon' })).statusCode).toBe(403);
    expect((await call('GET', '/v1/admin/stats', undefined, m.headers)).json().error.code).toBe('common.forbidden');
    expect((await call('GET', '/v1/admin/stats', undefined, { 'x-admin-token': ADMIN_TOKEN })).statusCode).toBe(200);
  });
});

describe('outils', () => {
  it('statistiques', async () => {
    await createMember(t);
    await createGuest(t);
    const res = await call('GET', '/v1/admin/stats');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users.members).toBeGreaterThanOrEqual(1);
    expect(body.users.guests).toBeGreaterThanOrEqual(1);
    expect(body.cauris.players).toBeGreaterThanOrEqual(WELCOME_BONUS);
    expect(body.online).toBe(0);
  });

  it('recherche par pseudo, e-mail ou identifiant', async () => {
    const m = await createMember(t);
    expect((await findUsers(t.db.pool, m.pseudo.slice(0, 10))).map((u) => u.id)).toContain(m.userId);
    expect(await resolveUserId(t.db.pool, m.email.toUpperCase())).toBe(m.userId);
    expect(await resolveUserId(t.db.pool, m.pseudo)).toBe(m.userId);
    const res = await call('GET', `/v1/admin/users?q=${encodeURIComponent(m.userId)}`);
    expect(res.json().items[0]).toMatchObject({ id: m.userId, pseudo: m.pseudo, balance: WELCOME_BONUS, birthYear: 1990 });
  });

  it('ajuste des cauris par le grand livre, une seule fois par clé', async () => {
    const m = await createMember(t);
    const payload = { amount: 250, reason: 'tournoi du quartier', idempotencyKey: `k-${m.userId}` };
    const first = await call('POST', `/v1/admin/users/${m.userId}/adjust`, payload);
    expect(first.json()).toMatchObject({ replayed: false });
    const again = await call('POST', `/v1/admin/users/${m.userId}/adjust`, payload);
    expect(again.json()).toMatchObject({ replayed: true, txId: first.json().txId });
    expect(await balanceOf(t.db.pool, m.userId)).toBe(WELCOME_BONUS + 250);
    const tooMuch = await call('POST', `/v1/admin/users/${m.userId}/adjust`, { ...payload, amount: -10_000, idempotencyKey: 'k2' });
    expect(tooMuch.json().error.code).toBe('wallet.insufficient_funds');
  });

  it('année de naissance (support seulement), vérification de l\'adresse, sessions, suppression', async () => {
    const m = await createMember(t);
    expect((await call('POST', `/v1/admin/users/${m.userId}/birth-year`, { birthYear: 1850 })).json().error.code).toBe(
      'auth.birth_year_invalid',
    );
    expect((await call('POST', `/v1/admin/users/${m.userId}/birth-year`, { birthYear: 1985 })).statusCode).toBe(200);
    expect((await call('POST', `/v1/admin/users/${m.userId}/verify-email`)).statusCode).toBe(200);
    const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: m.headers });
    expect(me.json()).toMatchObject({ emailVerified: true, permissions: { canStake: true } });

    await t.app.inject({ method: 'POST', url: '/v1/me/delete', headers: m.headers, payload: { password: m.password } });
    expect((await call('POST', `/v1/admin/users/${m.userId}/cancel-deletion`)).json()).toEqual({ cancelled: true });

    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { login: m.email, password: m.password, device: m.device },
    });
    const headers = { authorization: `Bearer ${login.json().accessToken as string}` };
    expect((await call('POST', `/v1/admin/users/${m.userId}/revoke-sessions`)).json().revoked).toBeGreaterThanOrEqual(1);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers })).json().error.code).toBe('auth.session_revoked');
  });

  it('lance une tâche planifiée à la demande', async () => {
    expect((await call('POST', '/v1/admin/jobs/accounts.erase_due/run')).json()).toEqual({ ran: true });
    expect((await call('POST', '/v1/admin/jobs/inconnue/run')).statusCode).toBe(404);
  });
});
