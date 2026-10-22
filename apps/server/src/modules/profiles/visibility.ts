/**
 * Visibilité d'un profil (SPEC §6) : un compte jeune (13–17 ans) est invisible des inconnus.
 * Il reste visible pour lui-même, pour les joueurs qui ont partagé une partie ou un salon
 * avec lui, et pour ceux qu'un module déclare proches (amis : équipe Communauté) :
 *
 *   import { registerProfileRelation } from '../profiles/visibility.js';
 *   registerProfileRelation('friends', (db, viewerId, targetId) => areFriends(db, viewerId, targetId));
 *
 * Le registre est propre au processus (une règle par nom, remplacée si on la redéclare).
 */
import type { AgeGroup } from '@kwatt/protocol';
import type { Sql } from '../../db/pool.js';

export type ProfileRelation = (db: Sql, viewerId: string, targetId: string) => Promise<boolean>;

const relations = new Map<string, ProfileRelation>();

export function registerProfileRelation(name: string, relation: ProfileRelation): void {
  relations.set(name, relation);
}

export function unregisterProfileRelation(name: string): void {
  relations.delete(name);
}

/** Les deux joueurs se sont-ils déjà retrouvés à la même table (partie ou salon) ? */
export async function haveSharedTable(db: Sql, a: string, b: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM game_players x JOIN game_players y ON y.game_id = x.game_id
      WHERE x.user_id = $1 AND y.user_id = $2
     UNION ALL
     SELECT 1 FROM room_members x JOIN room_members y ON y.room_id = x.room_id
      WHERE x.user_id = $1 AND y.user_id = $2
     LIMIT 1`,
    [a, b],
  );
  return r.rows.length > 0;
}

/** Le lecteur peut-il voir ce profil ? (le profil existe et n'est pas masqué : vérifié ailleurs) */
export async function canViewProfile(db: Sql, viewerId: string, targetId: string, targetAge: AgeGroup | null): Promise<boolean> {
  if (viewerId === targetId) return true;
  if (targetAge === 'adult') return true;
  if (await haveSharedTable(db, viewerId, targetId)) return true;
  for (const relation of relations.values()) {
    if (await relation(db, viewerId, targetId)) return true;
  }
  return false;
}
