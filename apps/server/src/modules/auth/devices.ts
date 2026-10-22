/**
 * Appareils (SPEC §6) : chaque installation de l'appli a un identifiant, envoyé à chaque
 * connexion. Deux comptes vus sur le même appareil ne peuvent JAMAIS miser l'un contre
 * l'autre (ni être à la même table avec mise) : `usersShareDevice` / `sharedDevicePairs`.
 */
import type { Device } from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';

/** Crée ou met à jour l'appareil ; rend son identifiant. */
export async function upsertDevice(db: Sql, device: Device, now: Date): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO devices (install_id, platform, app_version, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (install_id) DO UPDATE
       SET platform = EXCLUDED.platform,
           app_version = COALESCE(EXCLUDED.app_version, devices.app_version),
           last_seen = EXCLUDED.last_seen
     RETURNING id`,
    [device.installId, device.platform, device.appVersion ?? null, now],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('appareil non enregistré');
  return id;
}

/** Note que ce compte a été vu sur cet appareil. */
export async function linkUserDevice(db: Sql, userId: string, deviceId: string, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO user_devices (user_id, device_id, first_seen_at, last_seen_at) VALUES ($1, $2, $3, $3)
     ON CONFLICT (user_id, device_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
    [userId, deviceId, now],
  );
}

/** Enregistre l'appareil et le lien avec le compte ; rend l'identifiant de l'appareil. */
export async function touchDevice(db: Sql, userId: string, device: Device, now: Date): Promise<string> {
  const deviceId = await upsertDevice(db, device, now);
  await linkUserDevice(db, userId, deviceId, now);
  return deviceId;
}

/** true si les deux comptes ont été vus sur un même appareil. */
export async function usersShareDevice(db: Sql, a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM user_devices x JOIN user_devices y ON x.device_id = y.device_id
      WHERE x.user_id = $1 AND y.user_id = $2`,
    [a, b],
  );
  return (r.rows[0]?.n ?? 0) > 0;
}

/** Paires de comptes (parmi `userIds`) vus sur un même appareil : aucune ne doit miser ensemble. */
export async function sharedDevicePairs(db: Sql, userIds: string[]): Promise<Array<[string, string]>> {
  if (userIds.length < 2) return [];
  const r = await db.query<{ a: string; b: string }>(
    `SELECT DISTINCT x.user_id AS a, y.user_id AS b
       FROM user_devices x JOIN user_devices y ON x.device_id = y.device_id AND x.user_id < y.user_id
      WHERE x.user_id = ANY($1::uuid[]) AND y.user_id = ANY($1::uuid[])
      ORDER BY a, b`,
    [userIds],
  );
  return r.rows.map((row) => [row.a, row.b]);
}
