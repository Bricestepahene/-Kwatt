import {
  AuthSessionResponseSchema,
  LoginResponseSchema,
  MeSchema,
  PseudoAvailabilityResponseSchema,
  RegisterResponseSchema,
  isValidPseudoFormat,
} from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MINUTE, SECOND, DAY } from '../../lib/clock.js';
import { TEST_PASSWORD, buildTestApp, createGuest, createMember, testDevice, uniq, type TestApp } from '../../test/helpers.js';
import { sharedDevicePairs, usersShareDevice } from './devices.js';
import { requireAuth } from './plugin.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({
    suite: 'auth',
    extend: (app) => {
      app.get('/test/adult', { preHandler: app.requireAdult }, async (req) => ({ ok: requireAuth(req).userId }));
      app.get('/test/verified', { preHandler: app.requireVerified }, async () => ({ ok: true }));
      app.get('/test/member', { preHandler: app.requireMember }, async () => ({ ok: true }));
    },
  });
});
afterAll(async () => {
  await t.close();
});

const year = () => t.clock.now().getUTCFullYear();

function register(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  const id = uniq();
  return t.app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    headers,
    payload: {
      pseudo: `p_${id}`.slice(0, 20),
      email: `p.${id}@example.com`,
      password: TEST_PASSWORD,
      birthYear: 1990,
      acceptTerms: true,
      device: testDevice(),
      ...payload,
    },
  });
}

function get(url: string, token: string) {
  return t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

describe('inscription', () => {
  it('crée un profil, verse 500 cauris et envoie le code de vérification', async () => {
    const email = `brice.${uniq()}@example.com`;
    const res = await register({ email, pseudo: `brice_${uniq()}`.slice(0, 20), locale: 'fr' });
    expect(res.statusCode).toBe(201);
    const body = RegisterResponseSchema.parse(res.json());
    expect(body.converted).toBe(false);
    expect(body.welcomeBonus).toBe(500);
    expect(body.me).toMatchObject({ kind: 'member', emailVerified: false, ageGroup: 'adult', locale: 'fr', email });
    expect(body.me.permissions).toEqual({
      canStake: false,
      canPredict: false,
      canJoinPaidLeagues: false,
      canCreate: true,
      visibleToStrangers: true,
    });
    const wallet = await get('/v1/wallet', body.accessToken);
    expect(wallet.json()).toEqual({ balance: 500 });
    await t.app.mailer.idle();
    const mail = t.mail.last(email);
    expect(mail?.subject).toMatch(/^\d{6} est ton code Kwatt$/);
    expect(mail?.html).toContain('Vérifie ton adresse');
  });

  it('stocke le mot de passe en argon2id, jamais en clair', async () => {
    const m = await createMember(t);
    const r = await t.db.pool.query<{ password_hash: string }>('SELECT password_hash FROM auth_identities WHERE user_id = $1', [m.userId]);
    expect(r.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(r.rows[0]?.password_hash).not.toContain(m.password);
  });

  it('écrit l\'e-mail dans la langue du joueur', async () => {
    const m = await createMember(t, { locale: 'en' });
    await t.app.mailer.idle();
    expect(t.mail.last(m.email)?.subject).toMatch(/^\d{6} is your Kwatt code$/);
  });

  it('compte jeune entre 13 et 17 ans : ni mise, ni pronostic, invisible des inconnus', async () => {
    const res = await register({ birthYear: year() - 15 });
    expect(res.statusCode).toBe(201);
    const me = MeSchema.parse(res.json().me);
    expect(me.ageGroup).toBe('teen');
    expect(me.permissions).toEqual({
      canStake: false,
      canPredict: false,
      canJoinPaidLeagues: false,
      canCreate: true,
      visibleToStrangers: false,
    });
  });

  it('moins de 13 ans : pas de profil', async () => {
    const res = await register({ birthYear: year() - 12 });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('auth.too_young');
  });

  it('refuse une année impossible', async () => {
    for (const birthYear of [1800, year() + 1]) {
      const res = await register({ birthYear });
      expect(res.json().error.code).toBe('auth.birth_year_invalid');
    }
  });

  it('exige le consentement', async () => {
    const res = await register({ acceptTerms: false });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('auth.consent_required');
  });

  it('exige 8 caractères de mot de passe', async () => {
    const res = await register({ password: 'court' });
    expect(res.json()).toEqual({ error: { code: 'auth.password_too_short', params: { min: 8 } } });
  });

  it('refuse un pseudo mal formé ou interdit', async () => {
    expect((await register({ pseudo: 'a b' })).json().error.code).toBe('auth.pseudo_invalid');
    expect((await register({ pseudo: 'admin_237' })).json().error.code).toBe('auth.pseudo_banned');
  });

  it('refuse une adresse déjà utilisée, sans tenir compte de la casse', async () => {
    const m = await createMember(t);
    const res = await register({ email: m.email.toUpperCase() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('auth.email_taken');
  });

  it('pseudo pris (casse comprise) : 3 propositions libres', async () => {
    const m = await createMember(t, { pseudo: `Mireille_${uniq()}`.slice(0, 18) });
    const res = await register({ pseudo: m.pseudo.toLowerCase() });
    expect(res.statusCode).toBe(409);
    const { code, params } = res.json().error;
    expect(code).toBe('auth.pseudo_taken');
    expect(params.suggestions).toHaveLength(3);
    for (const s of params.suggestions as string[]) {
      expect(isValidPseudoFormat(s)).toBe(true);
      const free = await t.app.inject({ method: 'GET', url: `/v1/auth/pseudo/availability?pseudo=${encodeURIComponent(s)}` });
      expect(free.json().available).toBe(true);
    }
  });
});

describe('vérification de l\'adresse', () => {
  it('un code faux compte un essai ; 5 essais épuisent le code', async () => {
    const m = await createMember(t);
    await t.app.mailer.idle();
    const good = t.mail.lastCode(m.email) ?? '';
    const wrong = good === '000000' ? '111111' : '000000';
    const verify = (code: string) =>
      t.app.inject({ method: 'POST', url: '/v1/auth/email/verify', headers: m.headers, payload: { code } });
    const first = await verify(wrong);
    expect(first.json()).toEqual({ error: { code: 'auth.code_invalid', params: { attemptsLeft: 4 } } });
    for (let i = 0; i < 3; i++) await verify(wrong);
    expect((await verify(wrong)).json().error.code).toBe('auth.code_expired');
    expect((await verify(good)).json().error.code).toBe('auth.code_expired');
  });

  it('le bon code vérifie l\'adresse et ouvre les mises (18 ans et plus)', async () => {
    const m = await createMember(t, { verified: true });
    expect(m.me.emailVerified).toBe(true);
    expect(m.me.permissions.canStake).toBe(true);
    expect((await get('/test/verified', m.accessToken)).statusCode).toBe(200);
    const again = await t.app.inject({ method: 'POST', url: '/v1/auth/email/verify', headers: m.headers, payload: { code: '123456' } });
    expect(again.json().error.code).toBe('auth.already_verified');
  });

  it('le code expire après 10 minutes', async () => {
    const m = await createMember(t);
    await t.app.mailer.idle();
    const code = t.mail.lastCode(m.email);
    t.clock.advance(10 * MINUTE + SECOND);
    try {
      const res = await t.app.inject({ method: 'POST', url: '/v1/auth/email/verify', headers: m.headers, payload: { code } });
      expect(res.json().error.code).toBe('auth.code_expired');
    } finally {
      t.clock.advance(-(10 * MINUTE + SECOND));
    }
  });

  it('renvoi possible après 60 s seulement ; le nouveau code remplace l\'ancien', async () => {
    const m = await createMember(t);
    await t.app.mailer.idle();
    const old = t.mail.lastCode(m.email);
    const resend = () => t.app.inject({ method: 'POST', url: '/v1/auth/email/resend', headers: m.headers });
    const early = await resend();
    expect(early.statusCode).toBe(429);
    expect(early.json().error.code).toBe('auth.code_resend_too_soon');
    expect(early.json().error.params.retryAfterSeconds).toBeGreaterThan(0);
    t.clock.advance(61 * SECOND);
    const ok = await resend();
    expect(ok.statusCode).toBe(200);
    await t.app.mailer.idle();
    const fresh = t.mail.lastCode(m.email);
    if (old !== fresh) {
      const viaOld = await t.app.inject({ method: 'POST', url: '/v1/auth/email/verify', headers: m.headers, payload: { code: old } });
      expect(viaOld.json().error.code).toBe('auth.code_invalid');
    }
    const viaNew = await t.app.inject({ method: 'POST', url: '/v1/auth/email/verify', headers: m.headers, payload: { code: fresh } });
    expect(viaNew.statusCode).toBe(200);
  });
});

describe('connexion', () => {
  it('par pseudo (toute casse) ou par e-mail', async () => {
    const m = await createMember(t);
    for (const login of [m.pseudo.toUpperCase(), m.email, ` ${m.email.toUpperCase()} `]) {
      const res = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login, password: m.password, device: testDevice() } });
      expect(res.statusCode).toBe(200);
      const body = LoginResponseSchema.parse(res.json());
      expect(body.me.id).toBe(m.userId);
      expect(body.deletionCancelled).toBe(false);
    }
  });

  it('même réponse pour un mauvais mot de passe et un compte inconnu', async () => {
    const m = await createMember(t);
    const wrong = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login: m.pseudo, password: 'mauvais-mdp', device: testDevice() } });
    const unknown = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login: 'personne_ici', password: 'mauvais-mdp', device: testDevice() } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json().error.code).toBe('auth.invalid_credentials');
  });

  it('chaque connexion note l\'appareil ; deux comptes du même appareil sont repérés', async () => {
    const device = testDevice({ platform: 'ios' });
    const a = await createMember(t, { device });
    const b = await createMember(t);
    const c = await createMember(t);
    expect(await usersShareDevice(t.db.pool, a.userId, b.userId)).toBe(false);
    await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login: b.email, password: b.password, device } });
    expect(await usersShareDevice(t.db.pool, a.userId, b.userId)).toBe(true);
    const pairs = await sharedDevicePairs(t.db.pool, [a.userId, b.userId, c.userId]);
    expect(pairs).toEqual([[a.userId, b.userId].sort() as [string, string]]);
  });
});

describe('invité', () => {
  it('crée un compte invité lié à l\'appareil, sans droits de profil', async () => {
    const g = await createGuest(t);
    expect(g.me).toMatchObject({ kind: 'guest', pseudo: null, email: null, ageGroup: null, emailVerified: false });
    expect(Object.values(g.me.permissions).every((v) => v === false)).toBe(true);
    expect((await get('/v1/me', g.accessToken)).statusCode).toBe(200);
    const member = await get('/test/member', g.accessToken);
    expect(member.statusCode).toBe(403);
    expect(member.json().error.code).toBe('auth.member_required');
    expect((await get('/v1/wallet', g.accessToken)).json()).toEqual({ balance: 0 });
  });

  it('l\'inscription depuis l\'appareil convertit l\'invité (même identifiant, bonus versé une fois)', async () => {
    const g = await createGuest(t);
    const m = await createMember(t, { fromGuest: g });
    expect(m.userId).toBe(g.userId);
    expect(m.me.kind).toBe('member');
    const again = await t.db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE id = $1 AND kind = 'member'", [g.userId]);
    expect(again.rows[0]?.n).toBe(1);
    expect((await get('/v1/wallet', m.accessToken)).json()).toEqual({ balance: 500 });
    // Les jetons d'invité sont fermés.
    const old = await get('/v1/me', g.accessToken);
    expect(old.json().error.code).toBe('auth.session_revoked');
  });

  it('le même appareil reprend son invité (jetons perdus) ; un appareil neuf en crée un autre', async () => {
    const device = testDevice();
    const first = await t.app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { device } });
    expect(first.statusCode).toBe(201);
    expect(first.json().created).toBe(true);
    const again = await t.app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { device, locale: 'en' } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false, me: { id: first.json().me.id, locale: 'en' } });
    const other = await createGuest(t);
    expect(other.userId).not.toBe(first.json().me.id);
  });

  it('sans jeton, l\'inscription depuis l\'appareil convertit son invité actif (avec sa langue)', async () => {
    const device = testDevice();
    const g = await t.app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { device, locale: 'en' } });
    const guestId = g.json().me.id as string;
    const res = await register({ device });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ converted: true, welcomeBonus: 500, me: { id: guestId, kind: 'member', locale: 'en' } });
    // Un second profil sur le même appareil est un nouveau compte (plus d'invité à convertir).
    const second = await register({ device });
    expect(second.json()).toMatchObject({ converted: false });
    expect(second.json().me.id).not.toBe(guestId);
  });

  it('un invité converti ou en cours de suppression n\'est pas repris', async () => {
    const g = await createGuest(t);
    await createMember(t, { fromGuest: g });
    const afterConversion = await t.app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { device: g.device } });
    expect(afterConversion.statusCode).toBe(201);
    expect(afterConversion.json().me.id).not.toBe(g.userId);

    const g2 = await createGuest(t);
    const del = await t.app.inject({ method: 'POST', url: '/v1/me/delete', headers: g2.headers, payload: {} });
    expect(del.statusCode).toBe(200);
    const afterDeletion = await t.app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { device: g2.device } });
    expect(afterDeletion.json().me.id).not.toBe(g2.userId);
  });

  it('un jeton de profil à l\'inscription crée un nouveau compte (pas de conversion)', async () => {
    const m = await createMember(t);
    const res = await register({}, m.headers);
    expect(res.statusCode).toBe(201);
    expect(res.json().converted).toBe(false);
    expect(res.json().me.id).not.toBe(m.userId);
  });
});

describe('âge', () => {
  it('requireAdult refuse les comptes jeunes et les invités', async () => {
    const teen = await createMember(t, { birthYear: year() - 16 });
    const adult = await createMember(t);
    const g = await createGuest(t);
    expect((await get('/test/adult', teen.accessToken)).json().error.code).toBe('auth.adult_required');
    expect((await get('/test/adult', g.accessToken)).json().error.code).toBe('auth.member_required');
    expect((await get('/test/adult', adult.accessToken)).json()).toEqual({ ok: adult.userId });
  });

  it('requireVerified refuse une adresse non vérifiée', async () => {
    const m = await createMember(t);
    const res = await get('/test/verified', m.accessToken);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('auth.verification_required');
  });
});

describe('jetons', () => {
  it('le jeton d\'accès expire après 15 minutes', async () => {
    const m = await createMember(t);
    t.clock.advance(15 * MINUTE + SECOND);
    try {
      expect((await get('/v1/me', m.accessToken)).json().error.code).toBe('auth.token_expired');
    } finally {
      t.clock.advance(-(15 * MINUTE + SECOND));
    }
  });

  it('le renouvellement tourne ; réutiliser l\'ancien jeton ferme les sessions de l\'appareil', async () => {
    const m = await createMember(t);
    const refresh = (refreshToken: string, device = m.device) =>
      t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken, device } });
    const r1 = await refresh(m.refreshToken);
    expect(r1.statusCode).toBe(200);
    const next = AuthSessionResponseSchema.parse(r1.json());
    expect(next.refreshToken).not.toBe(m.refreshToken);
    expect((await get('/v1/me', next.accessToken)).statusCode).toBe(200);

    const reused = await refresh(m.refreshToken);
    expect(reused.statusCode).toBe(401);
    expect(reused.json().error.code).toBe('auth.refresh_reused');
    // Tout ce qui venait de cette session est fermé.
    expect((await get('/v1/me', next.accessToken)).json().error.code).toBe('auth.session_revoked');
    expect((await refresh(next.refreshToken)).json().error.code).toBe('auth.session_revoked');
  });

  it('refuse un jeton de renouvellement présenté par une autre installation', async () => {
    const m = await createMember(t);
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: m.refreshToken, device: testDevice() } });
    expect(res.json().error.code).toBe('auth.refresh_invalid');
  });

  it('le jeton de renouvellement expire après 30 jours', async () => {
    const m = await createMember(t);
    t.clock.advance(30 * DAY + SECOND);
    try {
      const res = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: m.refreshToken, device: m.device } });
      expect(res.json().error.code).toBe('auth.refresh_expired');
    } finally {
      t.clock.advance(-(30 * DAY + SECOND));
    }
  });

  it('un jeton inconnu est refusé', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: 'x'.repeat(43), device: testDevice() } });
    expect(res.json().error.code).toBe('auth.refresh_invalid');
  });

  it('déconnexion : la session ne sert plus', async () => {
    const m = await createMember(t);
    const out = await t.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: m.headers });
    expect(out.json()).toEqual({ ok: true });
    expect((await get('/v1/me', m.accessToken)).json().error.code).toBe('auth.session_revoked');
    const r = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: m.refreshToken, device: m.device } });
    expect(r.json().error.code).toBe('auth.session_revoked');
  });

  it('déconnexion de tous les appareils', async () => {
    const m = await createMember(t);
    const other = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login: m.email, password: m.password, device: testDevice() } });
    const otherToken = other.json().accessToken as string;
    await t.app.inject({ method: 'POST', url: '/v1/auth/logout-all', headers: m.headers });
    expect((await get('/v1/me', m.accessToken)).json().error.code).toBe('auth.session_revoked');
    expect((await get('/v1/me', otherToken)).json().error.code).toBe('auth.session_revoked');
  });
});

describe('mot de passe oublié', () => {
  const forgot = (email: string) => t.app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email } });
  const verify = (email: string, code: string) =>
    t.app.inject({ method: 'POST', url: '/v1/auth/password/reset/verify', payload: { email, code } });

  it('même réponse que le compte existe ou non ; aucun e-mail pour une adresse inconnue', async () => {
    const m = await createMember(t, { locale: 'en' });
    const known = await forgot(m.email);
    const unknown = await forgot(`personne.${uniq()}@example.com`);
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.json()).toEqual(unknown.json());
    await t.app.mailer.idle();
    expect(t.mail.last(m.email)?.subject).toMatch(/to choose a new Kwatt password$/);
  });

  it('code faux et adresse inconnue donnent la même erreur ; 5 essais au plus', async () => {
    const m = await createMember(t);
    await forgot(m.email);
    await t.app.mailer.idle();
    const good = t.mail.lastCode(m.email) ?? '';
    const wrong = good === '000000' ? '111111' : '000000';
    const a = await verify(m.email, wrong);
    const b = await verify(`personne.${uniq()}@example.com`, wrong);
    expect(a.json()).toEqual({ error: { code: 'auth.code_invalid', params: {} } });
    expect(b.json()).toEqual(a.json());
    for (let i = 0; i < 4; i++) await verify(m.email, wrong);
    const blocked = await verify(m.email, good);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('auth.too_many_attempts');
  });

  it('nouveau mot de passe : toutes les sessions fermées, cet appareil connecté', async () => {
    const m = await createMember(t);
    await forgot(m.email);
    await t.app.mailer.idle();
    const code = t.mail.lastCode(m.email) ?? '';
    const v = await verify(m.email, code);
    expect(v.statusCode).toBe(200);
    const { resetToken } = v.json() as { resetToken: string };
    const device = testDevice();
    const reset = (newPassword: string) =>
      t.app.inject({ method: 'POST', url: '/v1/auth/password/reset', payload: { resetToken, newPassword, device } });
    expect((await reset('court')).json().error.code).toBe('auth.password_too_short');
    const ok = await reset('nouveau-mot-de-passe');
    expect(ok.statusCode).toBe(200);
    const body = AuthSessionResponseSchema.parse(ok.json());
    expect(body.me.emailVerified).toBe(true);
    expect((await get('/v1/me', m.accessToken)).json().error.code).toBe('auth.session_revoked');
    expect((await get('/v1/me', body.accessToken)).statusCode).toBe(200);
    // Jeton à usage unique.
    expect((await reset('encore-un-autre-mdp')).json().error.code).toBe('auth.reset_token_invalid');
    const oldLogin = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login: m.email, password: m.password, device } });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login: m.email, password: 'nouveau-mot-de-passe', device } });
    expect(newLogin.statusCode).toBe(200);
    await t.app.mailer.idle();
    expect(t.mail.last(m.email)?.subject).toBe('Ton mot de passe Kwatt a changé');
  });
});

describe('changement de mot de passe', () => {
  it('exige le mot de passe actuel ; ferme les autres sessions et garde celle-ci', async () => {
    const m = await createMember(t);
    const other = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { login: m.email, password: m.password, device: testDevice() } });
    const change = (currentPassword: string, newPassword: string) =>
      t.app.inject({ method: 'POST', url: '/v1/auth/password/change', headers: m.headers, payload: { currentPassword, newPassword } });
    expect((await change('mauvais', 'nouveau-mot-de-passe')).json().error.code).toBe('auth.wrong_password');
    expect((await change(m.password, 'court')).json().error.code).toBe('auth.password_too_short');
    expect((await change(m.password, 'nouveau-mot-de-passe')).json()).toEqual({ ok: true });
    expect((await get('/v1/me', m.accessToken)).statusCode).toBe(200);
    expect((await get('/v1/me', other.json().accessToken as string)).json().error.code).toBe('auth.session_revoked');
  });
});

describe('disponibilité du pseudo', () => {
  const check = async (pseudo: string) =>
    PseudoAvailabilityResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: `/v1/auth/pseudo/availability?pseudo=${encodeURIComponent(pseudo)}` })).json(),
    );

  it('libre, pris, invalide, interdit', async () => {
    const m = await createMember(t);
    expect(await check(`libre_${uniq()}`.slice(0, 20))).toMatchObject({ available: true, reason: null, suggestions: [] });
    const taken = await check(m.pseudo);
    expect(taken).toMatchObject({ available: false, reason: 'taken' });
    expect(taken.suggestions).toHaveLength(3);
    const invalid = await check('jean pierre');
    expect(invalid).toMatchObject({ available: false, reason: 'invalid' });
    expect(invalid.suggestions[0]).toMatch(/^jean_pierre/);
    expect(await check('connard')).toEqual({ pseudo: 'connard', available: false, reason: 'banned', suggestions: [] });
  });
});
