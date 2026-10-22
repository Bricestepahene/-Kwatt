import { NotificationListResponseSchema, NotificationPreferencesSchema, NotifyMessageSchema } from '@kwatt/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { transaction } from '../../db/pool.js';
import { buildTestApp, connectWs, createGuest, createMember, type TestApp, type TestUser } from '../../test/helpers.js';
import type { TestWsClient } from '../../test/ws-client.js';

let t: TestApp;
const open: TestWsClient[] = [];
beforeAll(async () => {
  t = await buildTestApp({ suite: 'notifications', listen: true });
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
  t.push.sent.length = 0;
});
afterAll(async () => {
  await t.close();
});

let tokenCounter = 0;
const pushToken = () => `ExponentPushToken[test${String(++tokenCounter).padStart(8, '0')}abc]`;

async function registerToken(user: TestUser, token = pushToken()): Promise<string> {
  const res = await t.app.inject({ method: 'POST', url: '/v1/notifications/push-token', headers: user.headers, payload: { token } });
  expect(res.statusCode).toBe(200);
  return token;
}

/** Laisse partir les envois programmés après validation, puis attend les livraisons. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 5));
  await t.app.notifications.idle();
}

describe('notify', () => {
  it('enregistre la notification et l\'envoie en temps réel quand le joueur est connecté (sans push)', async () => {
    const m = await createMember(t);
    await registerToken(m);
    const ws = await connectWs(t, m);
    open.push(ws);
    await ws.next('hello');
    const n = await t.app.notifications.notify(t.app.db, m.userId, 'invites.room', { from: 'Mireille', code: 'ABCDEF' });
    const msg = NotifyMessageSchema.parse(await ws.next('notify'));
    expect(msg.notification).toEqual(n);
    expect(msg.notification).toMatchObject({ kind: 'invites.room', params: { from: 'Mireille', code: 'ABCDEF' }, readAt: null });
    expect(msg.unreadCount).toBe(1);
    await settle();
    expect(t.push.sent).toHaveLength(0);
  });

  it('joueur absent : push dans SA langue, avec le compteur', async () => {
    const fr = await createMember(t, { locale: 'fr' });
    const en = await createMember(t, { locale: 'en' });
    const tokFr = await registerToken(fr);
    const tokEn = await registerToken(en);
    await t.app.notifications.notify(t.app.db, fr.userId, 'invites.room', { from: 'Mireille' });
    await t.app.notifications.notify(t.app.db, en.userId, 'invites.room', { from: 'Mireille' });
    await settle();
    const toFr = t.push.sent.find((p) => p.to === tokFr);
    const toEn = t.push.sent.find((p) => p.to === tokEn);
    expect(toFr).toMatchObject({ title: 'Invitation', body: 'Mireille t\'invite dans son salon.', badge: 1, channelId: 'invites' });
    expect(toEn).toMatchObject({ title: 'Invitation', body: 'Mireille invites you to their room.', badge: 1 });
    expect(toFr?.data).toMatchObject({ kind: 'invites.room', params: { from: 'Mireille' } });
  });

  it('nombre mis en forme selon la langue ; type inconnu → texte générique', async () => {
    const fr = await createMember(t, { locale: 'fr' });
    const tok = await registerToken(fr);
    await t.app.notifications.notify(t.app.db, fr.userId, 'quest.completed', { amount: 2450 });
    await t.app.notifications.notify(t.app.db, fr.userId, 'misc.something_new', {});
    await settle();
    const sent = t.push.sent.filter((p) => p.to === tok);
    expect(sent[0]?.body).toBe('+2 450 cauris pour toi.');
    expect(sent[1]).toMatchObject({ title: 'Kwatt', body: 'Tu as une nouvelle notification.' });
  });

  it('les réglages « c\'est ton tour », « invitations », « ligue » coupent le push, pas la liste', async () => {
    const m = await createMember(t);
    const tok = await registerToken(m);
    const put = await t.app.inject({
      method: 'PUT',
      url: '/v1/notifications/preferences',
      headers: m.headers,
      payload: { turn: false, league: false },
    });
    expect(NotificationPreferencesSchema.parse(put.json())).toEqual({ turn: false, invites: true, league: false });
    await t.app.notifications.notify(t.app.db, m.userId, 'turn.your_turn', { game: 'ludo' });
    await t.app.notifications.notify(t.app.db, m.userId, 'league.match_soon', { opponent: 'Tchoumi' });
    await t.app.notifications.notify(t.app.db, m.userId, 'invites.challenge', { from: 'Mireille' });
    await t.app.notifications.notify(t.app.db, m.userId, 'quest.completed', { amount: 80 });
    await settle();
    expect(t.push.sent.filter((p) => p.to === tok).map((p) => (p.data as { kind: string }).kind)).toEqual([
      'invites.challenge',
      'quest.completed',
    ]);
    const list = await t.app.inject({ method: 'GET', url: '/v1/notifications', headers: m.headers });
    expect(list.json().items).toHaveLength(4);
    const get = await t.app.inject({ method: 'GET', url: '/v1/notifications/preferences', headers: m.headers });
    expect(get.json()).toEqual({ turn: false, invites: true, league: false });
  });

  it('dans une transaction annulée : ni ligne, ni message, ni push', async () => {
    const m = await createMember(t);
    await registerToken(m);
    await expect(
      transaction(t.app.db, async (tx) => {
        await t.app.notifications.notify(tx, m.userId, 'invites.room', { from: 'X' });
        throw new Error('annulée');
      }),
    ).rejects.toThrow('annulée');
    await settle();
    expect(t.push.sent).toHaveLength(0);
    const r = await t.db.pool.query('SELECT 1 FROM notifications WHERE user_id = $1', [m.userId]);
    expect(r.rows).toHaveLength(0);
  });

  it('dans une transaction validée : envoyée après la validation', async () => {
    const m = await createMember(t);
    const tok = await registerToken(m);
    await transaction(t.app.db, async (tx) => {
      await t.app.notifications.notify(tx, m.userId, 'invites.room', { from: 'X' });
      expect(t.push.sent).toHaveLength(0);
    });
    await settle();
    expect(t.push.sent.map((p) => p.to)).toEqual([tok]);
  });

  it('refuse un type mal formé', async () => {
    const m = await createMember(t);
    await expect(t.app.notifications.notify(t.app.db, m.userId, 'Pas Bon', {})).rejects.toThrow(/invalide/);
  });

  it('pas de push vers un compte en cours de suppression', async () => {
    const m = await createMember(t);
    const tok = await registerToken(m);
    await t.app.inject({ method: 'POST', url: '/v1/me/delete', headers: m.headers, payload: { password: m.password } });
    await t.app.notifications.notify(t.app.db, m.userId, 'quest.completed', { amount: 10 });
    await settle();
    expect(t.push.sent.filter((p) => p.to === tok)).toHaveLength(0);
  });
});

describe('jetons push', () => {
  it('refuse un jeton qui n\'est pas un jeton Expo', async () => {
    const m = await createMember(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/notifications/push-token',
      headers: m.headers,
      payload: { token: 'nimporte-quoi' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('push.token_invalid');
  });

  it('un jeton repris par un autre compte change de titulaire', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const tok = await registerToken(a);
    await registerToken(b, tok);
    await t.app.notifications.notify(t.app.db, a.userId, 'quest.completed', { amount: 1 });
    await t.app.notifications.notify(t.app.db, b.userId, 'quest.completed', { amount: 2 });
    await settle();
    expect(t.push.sent.map((p) => p.badge)).toEqual([1]);
    expect((t.push.sent[0]?.data as { params: { amount: number } }).params.amount).toBe(2);
  });

  it('DeviceNotRegistered désactive le jeton', async () => {
    const m = await createMember(t);
    const tok = await registerToken(m);
    t.push.unregistered.add(tok);
    await t.app.notifications.notify(t.app.db, m.userId, 'quest.completed', { amount: 1 });
    await settle();
    const r = await t.db.pool.query('SELECT disabled_at FROM push_tokens WHERE token = $1', [tok]);
    expect(r.rows[0]?.disabled_at).not.toBeNull();
    t.push.sent.length = 0;
    await t.app.notifications.notify(t.app.db, m.userId, 'quest.completed', { amount: 1 });
    await settle();
    expect(t.push.sent).toHaveLength(0);
  });

  it('la déconnexion coupe le push de l\'appareil ; DELETE retire un jeton', async () => {
    const m = await createMember(t);
    const tok = await registerToken(m);
    await t.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: m.headers });
    await t.app.notifications.notify(t.app.db, m.userId, 'quest.completed', { amount: 1 });
    await settle();
    expect(t.push.sent).toHaveLength(0);

    const g = await createGuest(t);
    const tok2 = await registerToken(g);
    const del = await t.app.inject({ method: 'DELETE', url: '/v1/notifications/push-token', headers: g.headers, payload: { token: tok2 } });
    expect(del.statusCode).toBe(200);
    await t.app.notifications.notify(t.app.db, g.userId, 'quest.completed', { amount: 1 });
    await settle();
    expect(t.push.sent.map((p) => p.to)).not.toContain(tok);
    expect(t.push.sent.map((p) => p.to)).not.toContain(tok2);
  });
});

describe('liste et lecture', () => {
  it('pagine du plus récent au plus ancien et compte les non lues', async () => {
    const m = await createMember(t);
    for (let i = 1; i <= 5; i++) {
      await t.app.notifications.notify(t.app.db, m.userId, 'quest.completed', { amount: i }, { push: 'never' });
      t.clock.advance(1000);
    }
    const p1 = NotificationListResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/v1/notifications?limit=2', headers: m.headers })).json(),
    );
    expect(p1.items.map((n) => n.params.amount)).toEqual([5, 4]);
    expect(p1.unreadCount).toBe(5);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = NotificationListResponseSchema.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/v1/notifications?limit=10&cursor=${encodeURIComponent(p1.nextCursor ?? '')}`,
          headers: m.headers,
        })
      ).json(),
    );
    expect(p2.items.map((n) => n.params.amount)).toEqual([3, 2, 1]);
    expect(p2.nextCursor).toBeNull();

    const one = await t.app.inject({
      method: 'POST',
      url: '/v1/notifications/read',
      headers: m.headers,
      payload: { ids: [p1.items[0]?.id] },
    });
    expect(one.json()).toEqual({ unreadCount: 4 });
    const all = await t.app.inject({ method: 'POST', url: '/v1/notifications/read', headers: m.headers, payload: { all: true } });
    expect(all.json()).toEqual({ unreadCount: 0 });
    const bad = await t.app.inject({ method: 'POST', url: '/v1/notifications/read', headers: m.headers, payload: {} });
    expect(bad.json().error.code).toBe('common.validation');
  });

  it('on ne marque pas comme lues les notifications d\'un autre', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const n = await t.app.notifications.notify(t.app.db, a.userId, 'quest.completed', { amount: 1 }, { push: 'never' });
    await t.app.inject({ method: 'POST', url: '/v1/notifications/read', headers: b.headers, payload: { ids: [n.id] } });
    expect(await t.app.notifications.unreadCount(a.userId)).toBe(1);
  });

  it('préférences par défaut : tout activé', async () => {
    const g = await createGuest(t);
    const res = await t.app.inject({ method: 'GET', url: '/v1/notifications/preferences', headers: g.headers });
    expect(res.json()).toEqual({ turn: true, invites: true, league: true });
  });
});
