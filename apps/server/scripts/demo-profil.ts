/**
 * Données de démonstration du profil (vérification visuelle, jamais dans l'appli livrée) :
 * quelques joueurs, des parties terminées, des achats, un avatar, des photos.
 *
 *   DATABASE_URL=… pnpm --filter @kwatt/server exec tsx scripts/demo-profil.ts http://127.0.0.1:8112 <ADMIN_TOKEN> [sortie.json]
 *
 * Le serveur doit tourner (API_PORT) sur la même base. Écrit les jetons des joueurs dans la sortie.
 */
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { createPool } from '../src/db/pool.js';
import { transfer } from '../src/modules/economy/ledger.js';

const [base = 'http://127.0.0.1:8112', adminToken = '', out = 'demo-profil.json'] = process.argv.slice(2);
const db = createPool(process.env.DATABASE_URL ?? '', 2);

interface Player {
  userId: string;
  accessToken: string;
  refreshToken: string;
  pseudo: string;
}

async function call<T>(method: string, path: string, body?: unknown, token?: string, raw?: { body: Buffer; type: string }): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(raw ? { 'content-type': raw.type } : {}),
    },
    body: raw ? raw.body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function register(pseudo: string, birthYear: number, locale: 'fr' | 'en' = 'fr'): Promise<Player> {
  const r = await call<{ accessToken: string; refreshToken: string; me: { id: string } }>('POST', '/v1/auth/register', {
    pseudo,
    email: `${pseudo}@demo.kwatt.test`,
    password: 'motdepasse-demo-237',
    birthYear,
    acceptTerms: true,
    locale,
    device: { installId: `demo-${pseudo}-install`, platform: 'web' },
  });
  await call('POST', `/v1/admin/users/${r.me.id}/verify-email`, undefined, adminToken);
  return { userId: r.me.id, accessToken: r.accessToken, refreshToken: r.refreshToken, pseudo };
}

let n = 0;
async function credit(userId: string, amount: number): Promise<void> {
  await call('POST', `/v1/admin/users/${userId}/adjust`, { amount, reason: 'démo', idempotencyKey: `demo-${userId}-${n++}` }, adminToken);
}

async function game(input: {
  variant: string;
  context?: 'machine' | 'room' | 'league';
  stake?: number;
  minutesAgo: number;
  players: Array<{ user: Player | null; name?: string; place: number | null; result: string }>;
}): Promise<string> {
  const at = new Date(Date.now() - input.minutesAgo * 60_000);
  const g = await db.query<{ id: string }>(
    `INSERT INTO games (context, variant, rules, rules_version, ranked, stake_per_player, status, started_at, ended_at)
     VALUES ($1, $2, '{}', 'demo', true, $3, 'finished', $4, $4) RETURNING id`,
    [input.context ?? 'room', input.variant, input.stake ?? 0, at],
  );
  const id = g.rows[0]?.id as string;
  let seat = 0;
  for (const p of input.players) {
    await db.query(
      `INSERT INTO game_players (game_id, seat, user_id, display_name, color, place, result) VALUES ($1, $2, $3, $4, 'c', $5, $6)`,
      [id, seat++, p.user?.userId ?? null, p.user?.pseudo ?? p.name ?? 'machine', p.place, p.result],
    );
  }
  return id;
}

async function photo(seed: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <rect width="600" height="600" fill="hsl(${seed},55%,45%)"/>
    <circle cx="300" cy="250" r="120" fill="#C98E5E"/><rect x="150" y="390" width="300" height="260" rx="140" fill="#1D2B6E"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

async function upload(p: Player, image: Buffer): Promise<void> {
  const boundary = `----demo${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  await call('POST', '/v1/me/photo', undefined, p.accessToken, { body, type: `multipart/form-data; boundary=${boundary}` });
}

const brice = await register('brice_237', 1990);
const mireille = await register('Mireille', 1994);
const armand = await register('armand_kmr', 1988, 'en');
const odile = await register('tata_odile', 1972);
const fresh = await register('nouveau_joueur', 2000);

await db.query(`UPDATE profiles SET quarter = 'Bonamoussadi' WHERE user_id = $1`, [brice.userId]);
await db.query(`UPDATE profiles SET quarter = 'Akwa' WHERE user_id = $1`, [mireille.userId]);
await db.query(
  `INSERT INTO player_ratings (user_id, variant, rating, games_played) VALUES
     ($1, 'dames10', 1482, 104), ($1, 'dames8', 1105, 3), ($1, 'ludo_classique', 1205, 71),
     ($2, 'dames10', 1390, 60)`,
  [brice.userId, mireille.userId],
);

// Derniers matchs de Brice (planche : défi avec mise, machine, coupe ; Ludo à 4).
const defi = await game({
  variant: 'dames10',
  stake: 200,
  minutesAgo: 60,
  players: [
    { user: brice, place: 1, result: 'win' },
    { user: mireille, place: 2, result: 'loss' },
  ],
});
await transfer(db, {
  kind: 'stake_payout',
  idempotencyKey: `demo_payout:${defi}`,
  gameId: defi,
  entries: [
    { wallet: { system: 'house' }, amount: -200 },
    { wallet: { userId: brice.userId }, amount: 200 },
  ],
  meta: { opponent: { userId: mireille.userId, pseudo: mireille.pseudo }, variant: 'dames10' },
});
const machine = await game({
  variant: 'dames10',
  context: 'machine',
  minutesAgo: 180,
  players: [
    { user: brice, place: 1, result: 'win' },
    { user: null, place: 2, result: 'loss' },
  ],
});
await db.query(`INSERT INTO rating_history (user_id, variant, game_id, before, after) VALUES ($1, 'dames10', $2, 1468, 1482)`, [
  brice.userId,
  machine,
]);
await transfer(db, {
  kind: 'machine_win',
  idempotencyKey: `demo_machine:${machine}`,
  gameId: machine,
  entries: [
    { wallet: { system: 'rewards' }, amount: -60 },
    { wallet: { userId: brice.userId }, amount: 60 },
  ],
  meta: { variant: 'dames10', difficulty: 'ton_niveau' },
});
const coupe = await game({
  variant: 'dames10',
  context: 'league',
  minutesAgo: 60 * 26,
  players: [
    { user: brice, place: 2, result: 'loss' },
    { user: armand, place: 1, result: 'win' },
  ],
});
await db.query(`INSERT INTO rating_history (user_id, variant, game_id, before, after) VALUES ($1, 'dames10', $2, 1480, 1468)`, [
  brice.userId,
  coupe,
]);
await game({
  variant: 'dames8',
  minutesAgo: 60 * 50,
  players: [
    { user: brice, place: null, result: 'draw' },
    { user: odile, place: null, result: 'draw' },
  ],
});
const ludo = await game({
  variant: 'ludo_classique',
  stake: 100,
  minutesAgo: 90,
  players: [
    { user: brice, place: 1, result: 'win' },
    { user: mireille, place: 2, result: 'loss' },
    { user: odile, place: 3, result: 'loss' },
    { user: armand, place: 4, result: 'loss' },
  ],
});
await transfer(db, {
  kind: 'stake_payout',
  idempotencyKey: `demo_payout:${ludo}`,
  gameId: ludo,
  entries: [
    { wallet: { system: 'house' }, amount: -300 },
    { wallet: { userId: brice.userId }, amount: 300 },
  ],
  meta: { opponents: ['Mireille', 'tata_odile', 'armand_kmr'], variant: 'ludo_classique' },
});
await game({
  variant: 'ludo_classique',
  context: 'machine',
  minutesAgo: 60 * 30,
  players: [
    { user: brice, place: 2, result: 'loss' },
    { user: null, place: 1, result: 'win' },
    { user: null, place: 3, result: 'loss' },
  ],
});

// Achats et avatar de Brice : coiffe et tenue de la planche, un avatar prêt, l'édition limitée.
await credit(brice.userId, 4000);
await call('POST', '/v1/shop/buy', { itemCodes: ['hat_kaba', 'outfit_kaba'] }, brice.accessToken);
await call('POST', '/v1/shop/buy', { itemCode: 'preset_debrouillard' }, brice.accessToken);
await call('POST', '/v1/shop/buy', { itemCode: 'preset_prince_wouri' }, brice.accessToken);
await call(
  'PUT',
  '/v1/me/avatar',
  { mode: 'avatar', selection: { kind: 'composed', skin: 'skin_3', hat: 'hat_ndop', outfit: 'outfit_obom' }, frame: 'frame_toghu' },
  brice.accessToken,
);
// D'autres acheteurs de l'édition limitée (exemplaires partis).
for (const p of [mireille, armand, odile]) {
  await credit(p.userId, 2500);
  await call('POST', '/v1/shop/buy', { itemCode: 'preset_prince_wouri' }, p.accessToken);
}
await call('PUT', '/v1/me/avatar', { selection: { kind: 'preset', preset: 'preset_prince_wouri' }, frame: 'frame_kaba' }, armand.accessToken);

// Photos : Mireille approuvée, Odile en vérification.
await upload(mireille, await photo(20));
await call('POST', `/v1/admin/photos/${mireille.userId}/approve`, undefined, adminToken);
await call('PUT', '/v1/me/avatar', { frame: 'frame_ndop' }, mireille.accessToken);
await upload(odile, await photo(200));

writeFileSync(out, JSON.stringify({ brice, mireille, armand, odile, fresh }, null, 2));
console.log(`Démo prête : ${out}`);
await db.end();
