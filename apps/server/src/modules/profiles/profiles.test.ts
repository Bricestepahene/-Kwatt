import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  MyAvatarSchema,
  PHOTO_SIZE,
  ProfileSchema,
  WELCOME_BONUS,
  type MyAvatar,
  type Profile,
} from '@kwatt/protocol';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createGuest, createMember, type TestApp, type TestMember, type TestUser } from '../../test/helpers.js';
import { transfer } from '../economy/ledger.js';
import { grantItem } from '../shop/catalog.js';
import { loadLooks } from './look.js';
import { photoDeps, uploadPhoto } from './photo.js';
import { registerProfileRelation, unregisterProfileRelation } from './visibility.js';

const ADMIN_TOKEN = 'admin-token-de-test-profil-0123456789abcdef';
const admin = { authorization: `Bearer ${ADMIN_TOKEN}` };

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'profiles', env: { ADMIN_TOKEN } });
});
afterAll(async () => {
  await t.close();
});

async function profileOf(viewer: TestUser, userId?: string): Promise<Profile> {
  const res = await t.app.inject({ method: 'GET', url: userId ? `/v1/profiles/${userId}` : '/v1/me/profile', headers: viewer.headers });
  expect(res.statusCode, res.body).toBe(200);
  return ProfileSchema.parse(res.json());
}

function putAvatar(m: TestMember, payload: object) {
  return t.app.inject({ method: 'PUT', url: '/v1/me/avatar', headers: m.headers, payload });
}

function multipart(data: Buffer, type = 'image/png', field = 'photo') {
  const boundary = `----kwatt${randomBytes(8).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="photo"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function uploadImage(m: TestMember, image: Buffer, type = 'image/png') {
  const body = multipart(image, type);
  return t.app.inject({ method: 'POST', url: '/v1/me/photo', headers: { ...m.headers, ...body.headers }, payload: body.payload });
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .png()
    .toBuffer();
}

/** Partie terminée entre des joueurs (null : la machine). */
async function addGame(input: {
  variant: string;
  context?: 'machine' | 'room' | 'league';
  ranked?: boolean;
  stake?: number;
  endedAt: Date;
  players: Array<{ userId: string | null; name: string; place: number | null; result: 'win' | 'loss' | 'draw' | 'abandon' | null }>;
}): Promise<string> {
  const g = await t.db.pool.query<{ id: string }>(
    `INSERT INTO games (context, variant, rules, rules_version, ranked, stake_per_player, status, started_at, ended_at)
     VALUES ($1, $2, '{}', 'test', $3, $4, 'finished', $5, $5) RETURNING id`,
    [input.context ?? 'room', input.variant, input.ranked ?? true, input.stake ?? 0, input.endedAt],
  );
  const gameId = g.rows[0]?.id as string;
  let seat = 0;
  for (const p of input.players) {
    await t.db.pool.query(
      `INSERT INTO game_players (game_id, seat, user_id, display_name, color, place, result) VALUES ($1, $2, $3, $4, 'c', $5, $6)`,
      [gameId, seat++, p.userId, p.name, p.place, p.result],
    );
  }
  return gameId;
}

describe('profil (écran 09)', () => {
  it('un nouveau profil : vitrine vide, force de départ, solde, cartes 0/48', async () => {
    const m = await createMember(t);
    const p = await profileOf(m);
    expect(p).toMatchObject({
      userId: m.userId,
      pseudo: m.pseudo,
      self: true,
      look: { avatar: { kind: 'initial' }, frame: null },
      photoPending: false,
      quarter: null,
      cauris: WELCOME_BONUS,
      gamesPlayed: 0,
      cards: { owned: 0, total: 48 },
      medals: { gold: 0, silver: 0, bronze: 0, total: 0 },
    });
    expect(p.games.map((g) => g.family)).toEqual(['dames', 'ludo', 'raisonnement']);
    const [dames, ludo, raisonnement] = p.games;
    // Force de départ 900 : Niv 2, Apprenti (SPEC §7).
    expect(dames?.standing).toMatchObject({ variant: 'dames10', rating: 900, level: 2, rank: 'apprenti', gamesPlayed: 0, nextLevel: 3 });
    expect(dames?.standing?.pointsToNextLevel).toBe(20);
    expect(dames?.record).toEqual({ wins: 0, draws: 0, losses: 0 });
    expect(dames?.recent).toEqual([]);
    expect(ludo?.standing?.variant).toBe('ludo_classique');
    expect(raisonnement?.standing).toBeNull();
  });

  it('niveau, force, V/N/D et derniers matchs lus dans les parties', async () => {
    const m = await createMember(t);
    const mireille = await createMember(t);
    await t.db.pool.query(
      `INSERT INTO player_ratings (user_id, variant, rating, games_played) VALUES ($1, 'dames10', 1482, 104), ($1, 'dames8', 1100, 3)`,
      [m.userId],
    );
    const base = Date.UTC(2026, 9, 1);
    // Défi avec mise contre Mireille, gagné : +200 cauris au journal.
    const defi = await addGame({
      variant: 'dames10',
      stake: 200,
      endedAt: new Date(base + 3000),
      players: [
        { userId: m.userId, name: m.pseudo, place: 1, result: 'win' },
        { userId: mireille.userId, name: mireille.pseudo, place: 2, result: 'loss' },
      ],
    });
    await transfer(t.db.pool, {
      kind: 'stake_payout',
      idempotencyKey: `test_payout:${defi}`,
      gameId: defi,
      entries: [
        { wallet: { system: 'house' }, amount: -200 },
        { wallet: { userId: m.userId }, amount: 200 },
      ],
    });
    // Contre la machine, classée : +14 de force.
    const machine = await addGame({
      variant: 'dames10',
      context: 'machine',
      endedAt: new Date(base + 2000),
      players: [
        { userId: m.userId, name: m.pseudo, place: 1, result: 'win' },
        { userId: null, name: 'machine', place: 2, result: 'loss' },
      ],
    });
    await t.db.pool.query(`INSERT INTO rating_history (user_id, variant, game_id, before, after) VALUES ($1, 'dames10', $2, 1468, 1482)`, [
      m.userId,
      machine,
    ]);
    // Une nulle et une défaite plus anciennes (8×8), et une partie de Ludo.
    await addGame({
      variant: 'dames8',
      endedAt: new Date(base + 1000),
      players: [
        { userId: m.userId, name: m.pseudo, place: null, result: 'draw' },
        { userId: mireille.userId, name: mireille.pseudo, place: null, result: 'draw' },
      ],
    });
    await addGame({
      variant: 'dames10',
      endedAt: new Date(base),
      players: [
        { userId: m.userId, name: m.pseudo, place: 2, result: 'abandon' },
        { userId: mireille.userId, name: mireille.pseudo, place: 1, result: 'win' },
      ],
    });
    await addGame({
      variant: 'ludo_classique',
      endedAt: new Date(base + 5000),
      players: [
        { userId: m.userId, name: m.pseudo, place: 1, result: 'win' },
        { userId: null, name: 'machine', place: 2, result: 'loss' },
        { userId: mireille.userId, name: mireille.pseudo, place: 3, result: 'loss' },
      ],
    });

    const p = await profileOf(m);
    expect(p.gamesPlayed).toBe(5);
    const dames = p.games[0];
    expect(dames?.standing).toMatchObject({ variant: 'dames10', rating: 1482, level: 17, rank: 'notable', nextLevel: 18 });
    expect(dames?.standing?.pointsToNextLevel).toBe(38);
    expect(dames?.standing?.progress).toBeCloseTo(0.05);
    expect(dames?.variants.map((v) => v.variant)).toEqual(['dames10', 'dames8']);
    expect(dames?.record).toEqual({ wins: 2, draws: 1, losses: 1 });
    expect(dames?.recent).toHaveLength(3);
    expect(dames?.recent[0]).toMatchObject({
      gameId: defi,
      result: 'win',
      stake: 200,
      cauris: 200,
      ratingDelta: null,
      opponents: [{ userId: mireille.userId, name: mireille.pseudo, machine: false }],
    });
    expect(dames?.recent[1]).toMatchObject({ gameId: machine, context: 'machine', ratingDelta: 14, cauris: null });
    expect(dames?.recent[1]?.opponents).toEqual([{ userId: null, name: 'machine', machine: true }]);
    expect(dames?.recent[2]).toMatchObject({ result: 'draw', place: null, variant: 'dames8' });
    const ludo = p.games[1];
    expect(ludo?.record).toEqual({ wins: 1, draws: 0, losses: 0 });
    expect(ludo?.recent[0]).toMatchObject({ result: 'win', place: 1, playerCount: 3 });
  });

  it('profil public : sans solde, sans la photo en vérification', async () => {
    const m = await createMember(t);
    const other = await createMember(t);
    const res = await uploadImage(m, await png(300, 200));
    expect(res.statusCode, res.body).toBe(200);
    const mine = await profileOf(m);
    expect(mine.photoPending).toBe(true);
    expect(mine.look.avatar.kind).toBe('photo');
    const seen = await profileOf(other, m.userId);
    expect(seen).toMatchObject({ self: false, cauris: null, photoPending: false, look: { avatar: { kind: 'initial' } } });
    // Un invité peut aussi regarder un profil d'adulte.
    const guest = await createGuest(t);
    expect((await profileOf(guest, m.userId)).pseudo).toBe(m.pseudo);
  });

  it('compte jeune : invisible des inconnus, visible après une partie partagée ou pour un proche déclaré', async () => {
    const teen = await createMember(t, { birthYear: new Date().getUTCFullYear() - 15 });
    const stranger = await createMember(t);
    const friend = await createMember(t);
    const hidden = await t.app.inject({ method: 'GET', url: `/v1/profiles/${teen.userId}`, headers: stranger.headers });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().error.code).toBe('profiles.not_found');
    // Le jeune voit son propre profil.
    expect((await profileOf(teen, teen.userId)).self).toBe(true);

    await addGame({
      variant: 'dames10',
      endedAt: new Date(),
      players: [
        { userId: teen.userId, name: teen.pseudo, place: 1, result: 'win' },
        { userId: stranger.userId, name: stranger.pseudo, place: 2, result: 'loss' },
      ],
    });
    expect((await profileOf(stranger, teen.userId)).pseudo).toBe(teen.pseudo);

    // Les amis (équipe Communauté) se déclarent par registerProfileRelation.
    expect((await t.app.inject({ method: 'GET', url: `/v1/profiles/${teen.userId}`, headers: friend.headers })).statusCode).toBe(404);
    registerProfileRelation('test_friends', async (_db, viewer, target) => viewer === friend.userId && target === teen.userId);
    try {
      expect((await profileOf(friend, teen.userId)).pseudo).toBe(teen.pseudo);
    } finally {
      unregisterProfileRelation('test_friends');
    }
  });

  it('introuvable : invité, compte en cours de suppression, identifiant inconnu', async () => {
    const m = await createMember(t);
    const guest = await createGuest(t);
    const gone = await createMember(t);
    await t.db.pool.query('UPDATE users SET delete_requested_at = now() WHERE id = $1', [gone.userId]);
    for (const id of [guest.userId, gone.userId, '00000000-0000-4000-8000-000000000000']) {
      const res = await t.app.inject({ method: 'GET', url: `/v1/profiles/${id}`, headers: m.headers });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('profiles.not_found');
    }
    expect((await t.app.inject({ method: 'GET', url: '/v1/profiles/pas-un-uuid', headers: m.headers })).json().error.code).toBe(
      'common.validation',
    );
    expect((await t.app.inject({ method: 'GET', url: '/v1/me/profile', headers: guest.headers })).json().error.code).toBe(
      'auth.member_required',
    );
  });

  it('compte les cartes possédées et les médailles (si la table existe)', async () => {
    const m = await createMember(t);
    await t.db.pool.query(`INSERT INTO items (code, kind, rarity) VALUES ('test_card_a', 'card', 'rare'), ('test_card_b', 'card', 'commune')`);
    await grantItem(t.db.pool, m.userId, 'test_card_a', 'reward');
    await grantItem(t.db.pool, m.userId, 'test_card_b', 'reward');
    await t.db.pool.query(`CREATE TABLE IF NOT EXISTS medals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, kind text)`);
    await t.db.pool.query(`INSERT INTO medals (user_id, kind) VALUES ($1, 'or'), ($1, 'bronze'), ($1, 'bronze')`, [m.userId]);
    const p = await profileOf(m);
    expect(p.cards).toEqual({ owned: 2, total: 48 });
    expect(p.medals).toEqual({ gold: 1, silver: 0, bronze: 2, total: 3 });
  });

  it('quartier : texte libre du profil en attendant la table des quartiers', async () => {
    const m = await createMember(t);
    await t.db.pool.query(`UPDATE profiles SET quarter = 'Bonamoussadi' WHERE user_id = $1`, [m.userId]);
    expect((await profileOf(m)).quarter).toEqual({ id: null, name: 'Bonamoussadi', city: null, country: null });
  });
});

describe('avatar (écran 10)', () => {
  it('enregistre un avatar composé de pièces de base et un cadre de base', async () => {
    const m = await createMember(t);
    const res = await putAvatar(m, {
      selection: { kind: 'composed', skin: 'skin_3', hat: 'hat_ndop', outfit: 'outfit_obom' },
      frame: 'frame_toghu',
    });
    expect(res.statusCode, res.body).toBe(200);
    const a: MyAvatar = MyAvatarSchema.parse(res.json());
    expect(a.selection).toEqual({ kind: 'composed', skin: 'skin_3', hat: 'hat_ndop', outfit: 'outfit_obom' });
    expect(a.look).toEqual({
      avatar: { kind: 'composed', skin: 2, hat: { fabric: 'ndop', shape: 'bonnet' }, outfit: 'obom' },
      frame: { code: 'frame_toghu', fabric: 'toghu', rarity: 'commune' },
    });
    // Les autres le voient aussi.
    const other = await createMember(t);
    expect((await profileOf(other, m.userId)).look).toEqual(a.look);
    // Sans coiffe.
    const bare = MyAvatarSchema.parse(
      (await putAvatar(m, { selection: { kind: 'composed', skin: 'skin_1', hat: null, outfit: 'outfit_obom' } })).json(),
    );
    expect(bare.look.avatar).toEqual({ kind: 'composed', skin: 0, hat: null, outfit: 'obom' });
    expect(bare.frame).toBe('frame_toghu');
  });

  it('refuse une pièce pas encore achetée et dit ce qu\'elle coûte', async () => {
    const m = await createMember(t);
    const res = await putAvatar(m, { selection: { kind: 'composed', skin: 'skin_2', hat: 'hat_kaba', outfit: 'outfit_toghu' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: 'avatar.not_owned', params: { items: ['hat_kaba', 'outfit_toghu'], price: 1050 } });
    // Le cadre du Fon ne s'achète pas : il ne compte pas dans le prix.
    const fon = await putAvatar(m, { frame: 'frame_trone_du_fon' });
    expect(fon.json().error).toEqual({ code: 'avatar.not_owned', params: { items: ['frame_trone_du_fon'], price: 0 } });
    // Après l'achat, l'enregistrement passe.
    await t.app.inject({ method: 'POST', url: '/v1/shop/buy', headers: m.headers, payload: { itemCodes: ['hat_kaba', 'outfit_kaba'] } });
    const ok = await putAvatar(m, { selection: { kind: 'composed', skin: 'skin_2', hat: 'hat_kaba', outfit: 'outfit_kaba' } });
    expect(ok.statusCode).toBe(200);
    expect(MyAvatarSchema.parse(ok.json()).look.avatar).toEqual({
      kind: 'composed',
      skin: 1,
      hat: { fabric: 'kaba', shape: 'foulard' },
      outfit: 'kaba',
    });
  });

  it('refuse une pièce à la mauvaise place ou inconnue', async () => {
    const m = await createMember(t);
    const res = await putAvatar(m, { selection: { kind: 'composed', skin: 'skin_2', hat: 'outfit_obom', outfit: 'outfit_obom' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({ code: 'avatar.invalid_item', params: { code: 'outfit_obom', slot: 'hat' } });
    expect((await putAvatar(m, { frame: 'frame_inconnu' })).json().error.code).toBe('avatar.invalid_item');
    expect((await putAvatar(m, { selection: { kind: 'preset', preset: 'hat_ndop' } })).json().error.code).toBe('avatar.invalid_item');
    expect((await putAvatar(m, { autre: 1 })).json().error.code).toBe('common.validation');
  });

  it('porte un avatar prêt acheté, puis revient à l\'initiale', async () => {
    const m = await createMember(t);
    await t.app.inject({ method: 'POST', url: '/v1/shop/buy', headers: m.headers, payload: { itemCode: 'preset_debrouillard' } });
    const a = MyAvatarSchema.parse((await putAvatar(m, { selection: { kind: 'preset', preset: 'preset_debrouillard' } })).json());
    expect(a.look.avatar).toEqual({
      kind: 'preset',
      code: 'preset_debrouillard',
      skin: 2,
      hat: { fabric: 'ndop', shape: 'bonnet' },
      outfit: 'ndop',
      background: 'obom',
    });
    const back = MyAvatarSchema.parse((await putAvatar(m, { selection: { kind: 'initial' }, frame: null })).json());
    expect(back.look).toEqual({ avatar: { kind: 'initial' }, frame: null });
  });

  it('le mode photo exige une photo', async () => {
    const m = await createMember(t);
    const res = await putAvatar(m, { mode: 'photo' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('photo.missing');
  });

  it('loadLooks : apparences de plusieurs joueurs pour les autres modules', async () => {
    const a = await createMember(t);
    const b = await createMember(t);
    const guest = await createGuest(t);
    await putAvatar(a, { selection: { kind: 'composed', skin: 'skin_5', hat: null, outfit: 'outfit_obom' }, frame: 'frame_kaba' });
    const looks = await loadLooks(t.db.pool, t.app.media, [a.userId, b.userId, guest.userId]);
    expect(looks.get(a.userId)?.frame?.fabric).toBe('kaba');
    expect(looks.get(b.userId)).toEqual({ avatar: { kind: 'initial' }, frame: null });
    expect(looks.has(guest.userId)).toBe(false);
  });
});

describe('photo de profil', () => {
  it('recadre en 512×512 WebP, en vérification, visible de toi seul', async () => {
    const m = await createMember(t);
    await putAvatar(m, { selection: { kind: 'composed', skin: 'skin_2', hat: null, outfit: 'outfit_obom' } });
    const res = await uploadImage(m, await png(900, 600));
    expect(res.statusCode, res.body).toBe(200);
    const a = MyAvatarSchema.parse(res.json());
    expect(a.mode).toBe('photo');
    expect(a.photo?.status).toBe('pending');
    expect(a.ownLook.avatar.kind).toBe('photo');
    expect(a.look.avatar.kind).toBe('composed');
    const url = a.photo?.url ?? '';
    expect(url).toMatch(/^http:\/\/kwatt\.test\/media\/photos\/[0-9a-f-]+\/[0-9a-f-]+\.webp$/);
    const file = await t.app.inject({ method: 'GET', url: url.replace('http://kwatt.test', '') });
    expect(file.statusCode).toBe(200);
    const meta = await sharp(file.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', PHOTO_SIZE, PHOTO_SIZE]);
  });

  it('une nouvelle photo remplace l\'ancienne (fichier supprimé)', async () => {
    const m = await createMember(t);
    const first = MyAvatarSchema.parse((await uploadImage(m, await png(400, 400))).json());
    const firstPath = t.app.media.pathOf((first.photo?.url ?? '').replace('http://kwatt.test/media/', ''));
    expect(existsSync(firstPath)).toBe(true);
    const second = MyAvatarSchema.parse((await uploadImage(m, await png(500, 400), 'image/png')).json());
    expect(second.photo?.url).not.toBe(first.photo?.url);
    expect(existsSync(firstPath)).toBe(false);
  });

  it('refuse un fichier illisible, trop petit, ou d\'un autre type', async () => {
    const m = await createMember(t);
    const garbage = await uploadImage(m, Buffer.from('pas une image du tout'), 'image/jpeg');
    expect(garbage.statusCode).toBe(400);
    expect(garbage.json().error).toEqual({ code: 'photo.invalid_image', params: { minSize: 128 } });
    expect((await uploadImage(m, await png(64, 64))).json().error.code).toBe('photo.invalid_image');
    const text = await uploadImage(m, Buffer.from('bonjour'), 'text/plain');
    expect(text.statusCode).toBe(415);
    expect(text.json().error.code).toBe('media.unsupported_type');
    const json = await t.app.inject({ method: 'POST', url: '/v1/me/photo', headers: m.headers, payload: { photo: 'x' } });
    expect(json.statusCode).toBe(415);
    const guest = await createGuest(t);
    const body = multipart(await png(200, 200));
    const g = await t.app.inject({ method: 'POST', url: '/v1/me/photo', headers: { ...guest.headers, ...body.headers }, payload: body.payload });
    expect(g.json().error.code).toBe('auth.member_required');
  });

  it('modération : approuver rend la photo visible de tous et prévient le joueur', async () => {
    const m = await createMember(t);
    const other = await createMember(t);
    await uploadImage(m, await png(300, 300));
    const list = await t.app.inject({ method: 'GET', url: '/v1/admin/photos', headers: admin });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((i: { userId: string }) => i.userId)).toContain(m.userId);
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/photos', headers: m.headers })).statusCode).toBe(403);

    const ok = await t.app.inject({ method: 'POST', url: `/v1/admin/photos/${m.userId}/approve`, headers: admin });
    expect(ok.json()).toEqual({ ok: true, status: 'approved' });
    expect((await profileOf(other, m.userId)).look.avatar.kind).toBe('photo');
    expect((await profileOf(m)).photoPending).toBe(false);
    const notes = await t.app.inject({ method: 'GET', url: '/v1/notifications', headers: m.headers });
    expect(notes.json().items.map((n: { kind: string }) => n.kind)).toContain('profile.photo_approved');

    // Revenir à l'avatar sans supprimer la photo, puis la remontrer.
    const back = MyAvatarSchema.parse((await putAvatar(m, { mode: 'avatar' })).json());
    expect(back.look.avatar.kind).toBe('initial');
    expect(back.photo?.status).toBe('approved');
    expect(MyAvatarSchema.parse((await putAvatar(m, { mode: 'photo' })).json()).look.avatar.kind).toBe('photo');
  });

  it('modération : refuser supprime la photo, l\'avatar reprend sa place', async () => {
    const m = await createMember(t);
    const up = MyAvatarSchema.parse((await uploadImage(m, await png(300, 300))).json());
    const path = t.app.media.pathOf((up.photo?.url ?? '').replace('http://kwatt.test/media/', ''));
    const res = await t.app.inject({ method: 'POST', url: `/v1/admin/photos/${m.userId}/reject`, headers: admin });
    expect(res.json()).toEqual({ ok: true, status: 'rejected' });
    expect(existsSync(path)).toBe(false);
    const a = MyAvatarSchema.parse((await t.app.inject({ method: 'GET', url: '/v1/me/avatar', headers: m.headers })).json());
    expect(a).toMatchObject({ mode: 'avatar', photo: { status: 'rejected', url: null }, ownLook: { avatar: { kind: 'initial' } } });
    const again = await t.app.inject({ method: 'POST', url: `/v1/admin/photos/${m.userId}/reject`, headers: admin });
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe('photo.not_found');
  });

  it('suppression de la photo par son titulaire', async () => {
    const m = await createMember(t);
    const up = MyAvatarSchema.parse((await uploadImage(m, await png(300, 300))).json());
    const path = t.app.media.pathOf((up.photo?.url ?? '').replace('http://kwatt.test/media/', ''));
    const res = await t.app.inject({ method: 'DELETE', url: '/v1/me/photo', headers: m.headers });
    expect(res.statusCode).toBe(200);
    expect(MyAvatarSchema.parse(res.json())).toMatchObject({ mode: 'avatar', photo: null });
    expect(existsSync(path)).toBe(false);
  });

  it('refuse un fichier plus gros que MEDIA_MAX_BYTES', async () => {
    const small = await buildTestApp({ suite: 'profiles_small', env: { MEDIA_MAX_BYTES: '4096' } });
    try {
      const m = await createMember(small);
      const noise = await sharp(randomBytes(300 * 300 * 3), { raw: { width: 300, height: 300, channels: 3 } }).png().toBuffer();
      const body = multipart(noise);
      const res = await small.app.inject({
        method: 'POST',
        url: '/v1/me/photo',
        headers: { ...m.headers, ...body.headers },
        payload: body.payload,
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error).toEqual({ code: 'media.too_large', params: { maxBytes: 4096 } });
    } finally {
      await small.close();
    }
  });

  it('PHOTO_AUTO_APPROVE : approuvée d\'office (D-10)', async () => {
    const m = await createMember(t);
    const a = await uploadPhoto({ ...photoDeps(t.app), autoApprove: true }, m.userId, await png(256, 256));
    expect(a.photo?.status).toBe('approved');
    expect(a.look.avatar.kind).toBe('photo');
  });

  it('l\'effacement à J+30 supprime le fichier et les objets', async () => {
    const m = await createMember(t);
    await t.app.inject({ method: 'POST', url: '/v1/shop/buy', headers: m.headers, payload: { itemCode: 'hat_kaba' } });
    const up = MyAvatarSchema.parse((await uploadImage(m, await png(300, 300))).json());
    const path = t.app.media.pathOf((up.photo?.url ?? '').replace('http://kwatt.test/media/', ''));
    const exported = await t.app.inject({ method: 'GET', url: '/v1/me/export', headers: m.headers });
    expect(exported.json().sections.avatar).toMatchObject({ mode: 'photo', photoStatus: 'pending' });
    const { eraseUser } = await import('../me/service.js');
    await eraseUser(t.db.pool, t.app.accounts, m.userId, new Date());
    expect(existsSync(path)).toBe(false);
    const owned = await t.db.pool.query('SELECT 1 FROM owned_items WHERE user_id = $1', [m.userId]);
    expect(owned.rows).toHaveLength(0);
  });
});
