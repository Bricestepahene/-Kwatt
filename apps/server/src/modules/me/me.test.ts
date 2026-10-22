import { ExportResponseSchema, LoginResponseSchema, MeSchema, SETTINGS_MAX_KEYS, WELCOME_BONUS } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY, HOUR } from '../../lib/clock.js';
import { buildTestApp, createGuest, createMember, type TestApp, type TestUser } from '../../test/helpers.js';
import { balanceOf } from '../economy/ledger.js';

const erasedByHook: string[] = [];

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({
    suite: 'me',
    extend: (app) => {
      // Un module ajoute sa section à l'export et son effacement.
      app.accounts.addExportSection('test_module', async (_db, userId) => ({ userId, ok: true }));
      app.accounts.onErase('test_module', async (_tx, userId) => {
        erasedByHook.push(userId);
      });
    },
  });
});
afterAll(async () => {
  await t.close();
});

function call(method: 'GET' | 'PATCH' | 'POST', url: string, user: Pick<TestUser, 'headers'>, payload?: unknown) {
  return t.app.inject({ method, url, headers: user.headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
}

describe('GET /v1/me', () => {
  it('rend le profil minimal, sans année de naissance', async () => {
    const m = await createMember(t, { locale: 'en' });
    const res = await call('GET', '/v1/me', m);
    expect(res.statusCode).toBe(200);
    const me = MeSchema.parse(res.json());
    expect(me).toMatchObject({ id: m.userId, kind: 'member', pseudo: m.pseudo, email: m.email, locale: 'en', ageGroup: 'adult' });
    expect(JSON.stringify(res.json())).not.toContain('1990');
  });

  it('rend aussi le compte invité', async () => {
    const g = await createGuest(t);
    const me = MeSchema.parse((await call('GET', '/v1/me', g)).json());
    expect(me).toMatchObject({ kind: 'guest', pseudo: null, settings: {} });
  });
});

describe('pseudo', () => {
  it('changeable une fois tous les 30 jours', async () => {
    const m = await createMember(t);
    const first = await call('PATCH', '/v1/me/pseudo', m, { pseudo: `neuf_${m.userId.slice(0, 6)}` });
    expect(first.statusCode).toBe(200);
    expect(first.json().pseudo).toBe(`neuf_${m.userId.slice(0, 6)}`);
    expect(first.json().pseudoChangeAvailableAt).not.toBeNull();

    const tooSoon = await call('PATCH', '/v1/me/pseudo', m, { pseudo: `autre_${m.userId.slice(0, 6)}` });
    expect(tooSoon.statusCode).toBe(409);
    expect(tooSoon.json().error.code).toBe('profile.pseudo_change_too_soon');
    expect(tooSoon.json().error.params.nextChangeAt).toBe(first.json().pseudoChangeAvailableAt);

    t.clock.advance(30 * DAY + 1000);
    // Le jeton d'accès a expiré entre-temps : on se reconnecte.
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { login: m.email, password: m.password, device: m.device },
    });
    const headers = { authorization: `Bearer ${login.json().accessToken as string}` };
    const later = await call('PATCH', '/v1/me/pseudo', { headers }, { pseudo: `autre_${m.userId.slice(0, 6)}` });
    expect(later.statusCode).toBe(200);
    expect(later.json().pseudo).toBe(`autre_${m.userId.slice(0, 6)}`);
  });

  it('refuse un pseudo pris (avec 3 propositions), interdit ou mal formé', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const taken = await call('PATCH', '/v1/me/pseudo', b, { pseudo: a.pseudo.toUpperCase() });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('auth.pseudo_taken');
    expect(taken.json().error.params.suggestions).toHaveLength(3);
    expect((await call('PATCH', '/v1/me/pseudo', b, { pseudo: 'kwatt_officiel' })).json().error.code).toBe('auth.pseudo_banned');
    expect((await call('PATCH', '/v1/me/pseudo', b, { pseudo: 'a b' })).json().error.code).toBe('auth.pseudo_invalid');
  });

  it('réservé aux profils', async () => {
    const g = await createGuest(t);
    const res = await call('PATCH', '/v1/me/pseudo', g, { pseudo: 'invite_42' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('auth.member_required');
  });
});

describe('langue et réglages', () => {
  it('la langue se change, invités compris', async () => {
    const g = await createGuest(t);
    const res = await call('PATCH', '/v1/me/locale', g, { locale: 'en' });
    expect(res.statusCode).toBe(200);
    expect(res.json().locale).toBe('en');
    expect((await call('PATCH', '/v1/me/locale', g, { locale: 'de' })).json().error.code).toBe('common.validation');
  });

  it('les réglages fusionnent ; null retire une clé ; 50 clés au plus', async () => {
    const m = await createMember(t);
    await call('PATCH', '/v1/me/settings', m, { settings: { sound: 'balafon', volume: 0.6, vibrate: true } });
    const res = await call('PATCH', '/v1/me/settings', m, { settings: { sound: 'tamtam', vibrate: null } });
    expect(res.json()).toEqual({ settings: { sound: 'tamtam', volume: 0.6 } });
    expect((await call('GET', '/v1/me/settings', m)).json()).toEqual({ settings: { sound: 'tamtam', volume: 0.6 } });

    const many = Object.fromEntries(Array.from({ length: SETTINGS_MAX_KEYS - 1 }, (_, i) => [`k${i}`, i]));
    const tooMany = await call('PATCH', '/v1/me/settings', m, { settings: many });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.code).toBe('profile.settings_invalid');
  });
});

describe('suppression du compte', () => {
  it('exige le mot de passe, ferme les sessions, prévient par e-mail ; se reconnecter annule', async () => {
    const m = await createMember(t);
    const wrong = await call('POST', '/v1/me/delete', m, { password: 'pas-le-bon' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('auth.wrong_password');

    const now = t.clock.now();
    const res = await call('POST', '/v1/me/delete', m, { password: m.password });
    expect(res.statusCode).toBe(200);
    expect(res.json().deletionScheduledFor).toBe(new Date(now.getTime() + 30 * DAY).toISOString());
    expect((await call('GET', '/v1/me', m)).json().error.code).toBe('auth.session_revoked');
    await t.app.mailer.idle();
    expect(t.mail.last(m.email)?.subject).toMatch(/Suppression/);

    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { login: m.pseudo, password: m.password, device: m.device },
    });
    expect(login.statusCode).toBe(200);
    const body = LoginResponseSchema.parse(login.json());
    expect(body.deletionCancelled).toBe(true);
    expect(body.me.deletionRequestedAt).toBeNull();
  });

  it('effacement définitif à J+30 : données personnelles effacées, pseudo et adresse libérés', async () => {
    const m = await createMember(t);
    const gameId = (
      await t.db.pool.query<{ id: string }>(
        `INSERT INTO games (context, variant, rules, rules_version, ranked, status)
         VALUES ('machine', 'dames10', '{}', 'test', false, 'finished') RETURNING id`,
      )
    ).rows[0]?.id;
    await t.db.pool.query(
      "INSERT INTO game_players (game_id, seat, user_id, display_name, color) VALUES ($1, 0, $2, $3, 'white')",
      [gameId, m.userId, m.pseudo],
    );
    await t.app.notifications.notify(t.db.pool, m.userId, 'quest.completed', { amount: 80 });
    await call('POST', '/v1/me/delete', m, { password: m.password });

    // Avant J+30 : rien n'est effacé.
    t.clock.advance(29 * DAY);
    expect(await t.app.jobs.runNow('accounts.erase_due')).toBe(true);
    const before = await t.db.pool.query('SELECT erased_at FROM users WHERE id = $1', [m.userId]);
    expect(before.rows[0]?.erased_at).toBeNull();

    t.clock.advance(DAY + HOUR);
    expect(await t.app.jobs.runNow('accounts.erase_due')).toBe(true);
    const u = await t.db.pool.query('SELECT erased_at, birth_year FROM users WHERE id = $1', [m.userId]);
    expect(u.rows[0]?.erased_at).not.toBeNull();
    expect(u.rows[0]?.birth_year).toBeNull();
    for (const table of ['profiles', 'auth_identities', 'auth_sessions', 'user_devices', 'notifications', 'refresh_tokens']) {
      const r = await t.db.pool.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [m.userId]);
      expect(r.rows, table).toHaveLength(0);
    }
    const gp = await t.db.pool.query('SELECT display_name FROM game_players WHERE game_id = $1', [gameId]);
    expect(gp.rows[0]?.display_name).toBe('');
    // Les cauris retournent à la maison par le grand livre ; le journal reste.
    expect(await balanceOf(t.db.pool, m.userId)).toBe(0);
    const journal = await t.db.pool.query<{ kind: string }>(
      `SELECT t.kind FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.tx_id
         JOIN wallets w ON w.id = e.wallet_id WHERE w.user_id = $1 ORDER BY t.created_at`,
      [m.userId],
    );
    expect(journal.rows.map((r) => r.kind)).toEqual(['welcome_bonus', 'account_erased']);
    expect(erasedByHook).toContain(m.userId);

    // Plus de connexion possible ; pseudo et adresse sont libres.
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { login: m.email, password: m.password, device: m.device },
    });
    expect(login.json().error.code).toBe('auth.invalid_credentials');
    const again = await createMember(t, { pseudo: m.pseudo, email: m.email });
    expect(again.userId).not.toBe(m.userId);
    expect(await balanceOf(t.db.pool, again.userId)).toBe(WELCOME_BONUS);
  });

  it('un invité demande la suppression sans mot de passe', async () => {
    const g = await createGuest(t);
    const res = await call('POST', '/v1/me/delete', g, {});
    expect(res.statusCode).toBe(200);
    expect((await call('GET', '/v1/me', g)).statusCode).toBe(401);
  });
});

describe('export des données', () => {
  it('rend toutes les sections en JSON, en pièce jointe', async () => {
    const m = await createMember(t);
    await t.app.notifications.notify(t.db.pool, m.userId, 'quest.completed', { amount: 50 });
    const res = await call('GET', '/v1/me/export', m);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="kwatt-export-\d{4}-\d{2}-\d{2}\.json"/);
    const data = ExportResponseSchema.parse(res.json());
    expect(data.userId).toBe(m.userId);
    expect(Object.keys(data.sections).sort()).toEqual(
      ['account', 'devices', 'games', 'notifications', 'sessions', 'test_module', 'wallet'].sort(),
    );
    expect(data.sections.account).toMatchObject({ pseudo: m.pseudo, email: m.email, birthYear: 1990 });
    expect(data.sections.wallet).toMatchObject({ balance: WELCOME_BONUS });
    expect((data.sections.notifications as unknown[]).length).toBe(1);
    expect(JSON.stringify(data)).not.toMatch(/password|token_hash|argon2/i);
  });
});
