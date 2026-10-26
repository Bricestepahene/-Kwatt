/**
 * Amis (écran 12, lien kwatt://ami/CODE ; contrat C6) : demandes, codes d'ami, recherche,
 * liste avec présence et activité (joue, regarde). Profils seulement.
 *
 * Une demande vers quelqu'un qui t'a déjà demandé vaut acceptation. Un blocage dans un sens
 * ou dans l'autre empêche toute demande et défait l'amitié (module reports).
 */
import {
  MAX_FRIENDS,
  MAX_PENDING_REQUESTS,
  type Friend,
  type FriendActivity,
  type FriendCodeTarget,
  type FriendRelation,
  type FriendRequestResult,
  type FriendRequestView,
  type FriendSearchItem,
  type FriendsResponse,
} from '@kwatt/protocol';
import { randomInt } from 'node:crypto';
import { transaction, type Pool, type Sql } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { RealtimeHub } from '../../realtime/hub.js';
import { ageBand } from '../auth/age.js';
import { gameTopic, type GameActor } from '../games/actor.js';
import type { MediaStore } from '../media/store.js';
import type { NotificationService } from '../notifications/service.js';
import { loadLooks } from '../profiles/look.js';
import { canViewProfile } from '../profiles/visibility.js';
import { friendIds, isBlocked, pairOf } from './relations.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface FriendsDeps {
  db: Pool;
  clock: Clock;
  media: MediaStore;
  hub: RealtimeHub;
  notifications: NotificationService;
  /** Parties en cours (activité des amis). */
  liveGames: () => GameActor[];
}

interface PlayerRow {
  id: string;
  pseudo: string;
  birth_year: number | null;
  last_seen_at: Date | null;
}

export class FriendsService {
  constructor(private readonly deps: FriendsDeps) {}

  /** Code d'ami du joueur, créé à la première demande. */
  async myCode(userId: string): Promise<string> {
    const found = await this.deps.db.query<{ code: string }>('SELECT code FROM friend_codes WHERE user_id = $1', [userId]);
    if (found.rows[0]) return found.rows[0].code;
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      const r = await this.deps.db.query<{ code: string }>(
        `INSERT INTO friend_codes (user_id, code) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET code = friend_codes.code RETURNING code`,
        [userId, code],
      ).catch((err: unknown) => {
        // Code déjà pris par un autre joueur : on retire au sort.
        if ((err as { code?: string }).code === '23505') return null;
        throw err;
      });
      if (r?.rows[0]) return r.rows[0].code;
    }
    throw new Error('code d’ami introuvable après 8 tirages');
  }

  async relation(viewerId: string, otherId: string): Promise<FriendRelation> {
    const [a, b] = pairOf(viewerId, otherId);
    const r = await this.deps.db.query<{ status: string; requested_by: string }>(
      'SELECT status, requested_by FROM friendships WHERE user_a = $1 AND user_b = $2',
      [a, b],
    );
    const row = r.rows[0];
    if (!row) return 'none';
    if (row.status === 'accepted') return 'friend';
    return row.requested_by === viewerId ? 'outgoing' : 'incoming';
  }

  private async players(ids: string[]): Promise<Map<string, PlayerRow>> {
    if (ids.length === 0) return new Map();
    const r = await this.deps.db.query<PlayerRow>(
      `SELECT u.id, p.pseudo::text AS pseudo, u.birth_year, u.last_seen_at
         FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE u.id = ANY($1::uuid[]) AND u.erased_at IS NULL`,
      [ids],
    );
    return new Map(r.rows.map((row) => [row.id, row]));
  }

  /** Joueur visible pour `viewerId` (un compte jeune reste invisible des inconnus). */
  private async visible(viewerId: string, row: PlayerRow): Promise<boolean> {
    const age = row.birth_year === null ? null : ageBand(row.birth_year, this.deps.clock.now()) === 'adult' ? 'adult' : 'teen';
    return canViewProfile(this.deps.db, viewerId, row.id, age);
  }

  /** Ce que fait le joueur en ce moment : il joue, sinon il regarde une partie. */
  activityOf(userId: string): FriendActivity | undefined {
    let watching: FriendActivity | undefined;
    for (const actor of this.deps.liveGames()) {
      if (actor.status !== 'playing') continue;
      const cfg = actor.config;
      const family = cfg.family === 'dames' || cfg.family === 'ludo' ? cfg.family : undefined;
      if (actor.isPlayer(userId)) {
        return {
          kind: 'playing',
          gameId: cfg.id,
          ...(family ? { family } : {}),
          progress: actor.progress(),
          watchable: cfg.listed && cfg.context !== 'machine',
        };
      }
      if (!watching && cfg.listed && this.deps.hub.subscribers(gameTopic(cfg.id)).some((c) => c.userId === userId)) {
        watching = { kind: 'watching', gameId: cfg.id, ...(family ? { family } : {}), progress: actor.progress(), watchable: true };
      }
    }
    return watching;
  }

  /** GET /v1/friends : en ligne d'abord (par pseudo), puis hors ligne (vus récemment d'abord). */
  async list(userId: string): Promise<FriendsResponse> {
    const ids = await friendIds(this.deps.db, userId);
    const rows = await this.players(ids);
    const looks = await loadLooks(this.deps.db, this.deps.media, ids, userId);
    const items: Friend[] = [];
    for (const id of ids) {
      const row = rows.get(id);
      if (!row) continue;
      const online = this.deps.hub.isOnline(id);
      const activity = online ? this.activityOf(id) : undefined;
      items.push({
        userId: id,
        pseudo: row.pseudo,
        avatar: looks.get(id) ?? null,
        online,
        ...(activity ? { activity } : {}),
        lastSeenAt: online || !row.last_seen_at ? null : row.last_seen_at.toISOString(),
      });
    }
    items.sort((x, y) => {
      if (x.online !== y.online) return x.online ? -1 : 1;
      if (!x.online) {
        const dx = x.lastSeenAt ? Date.parse(x.lastSeenAt) : 0;
        const dy = y.lastSeenAt ? Date.parse(y.lastSeenAt) : 0;
        if (dx !== dy) return dy - dx;
      }
      return x.pseudo.localeCompare(y.pseudo, 'fr');
    });
    const pending = await this.deps.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM friendships
        WHERE (user_a = $1 OR user_b = $1) AND status = 'pending' AND requested_by <> $1`,
      [userId],
    );
    return { items, incomingRequests: pending.rows[0]?.n ?? 0 };
  }

  /** Demandes reçues et envoyées, avec ce qui aide à reconnaître le joueur. */
  async requests(userId: string): Promise<{ incoming: FriendRequestView[]; outgoing: FriendRequestView[] }> {
    const r = await this.deps.db.query<{ other: string; requested_by: string; created_at: Date }>(
      `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS other, requested_by, created_at
         FROM friendships WHERE (user_a = $1 OR user_b = $1) AND status = 'pending'
        ORDER BY created_at DESC`,
      [userId],
    );
    const ids = r.rows.map((x) => x.other);
    const rows = await this.players(ids);
    const looks = await loadLooks(this.deps.db, this.deps.media, ids, userId);
    const extra = await this.deps.db.query<{ id: string; quarter: string | null; games: number; league: string | null }>(
      `SELECT o.id,
              (SELECT COALESCE(q.name, q.city) FROM profiles p JOIN quarters q ON q.id = p.quarter WHERE p.user_id = o.id) AS quarter,
              (SELECT count(DISTINCT x.game_id)::int FROM game_players x JOIN game_players y ON y.game_id = x.game_id
                WHERE x.user_id = $1 AND y.user_id = o.id) AS games,
              (SELECT l.name FROM league_members a JOIN league_members b ON b.league_id = a.league_id
                 JOIN leagues l ON l.id = a.league_id
                WHERE a.user_id = $1 AND b.user_id = o.id ORDER BY a.joined_at DESC LIMIT 1) AS league
         FROM unnest($2::uuid[]) AS o(id)`,
      [userId, ids],
    );
    const info = new Map(extra.rows.map((x) => [x.id, x]));
    const incoming: FriendRequestView[] = [];
    const outgoing: FriendRequestView[] = [];
    for (const req of r.rows) {
      const row = rows.get(req.other);
      if (!row) continue;
      const more = info.get(req.other);
      const view: FriendRequestView = {
        userId: req.other,
        pseudo: row.pseudo,
        avatar: looks.get(req.other) ?? null,
        direction: req.requested_by === userId ? 'outgoing' : 'incoming',
        createdAt: req.created_at.toISOString(),
        quarter: more?.quarter ?? null,
        gamesTogether: more?.games ?? 0,
        league: more?.league ?? null,
      };
      (view.direction === 'incoming' ? incoming : outgoing).push(view);
    }
    return { incoming, outgoing };
  }

  /** Recherche par début de pseudo ; les comptes jeunes inconnus et les joueurs bloqués n'apparaissent pas. */
  async search(userId: string, q: string): Promise<FriendSearchItem[]> {
    const pattern = q.replace(/[\\%_]/g, (c) => `\\${c}`) + '%';
    const r = await this.deps.db.query<PlayerRow>(
      `SELECT u.id, p.pseudo::text AS pseudo, u.birth_year, u.last_seen_at
         FROM profiles p JOIN users u ON u.id = p.user_id
        WHERE p.pseudo ILIKE $2 AND u.id <> $1 AND u.erased_at IS NULL AND u.delete_requested_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
        ORDER BY char_length(p.pseudo), p.pseudo LIMIT 40`,
      [userId, pattern],
    );
    const shown: PlayerRow[] = [];
    for (const row of r.rows) {
      if (shown.length >= 20) break;
      if (await this.visible(userId, row)) shown.push(row);
    }
    const looks = await loadLooks(this.deps.db, this.deps.media, shown.map((x) => x.id), userId);
    const items: FriendSearchItem[] = [];
    for (const row of shown) {
      items.push({ userId: row.id, pseudo: row.pseudo, avatar: looks.get(row.id) ?? null, relation: await this.relation(userId, row.id) });
    }
    return items;
  }

  /** Joueur derrière un code d'ami (le lien est partagé exprès : visible même pour un compte jeune). */
  async byCode(userId: string, code: string): Promise<FriendCodeTarget> {
    const r = await this.deps.db.query<{ user_id: string }>('SELECT user_id FROM friend_codes WHERE code = $1', [code]);
    const target = r.rows[0]?.user_id;
    const row = target ? (await this.players([target])).get(target) : undefined;
    if (!target || !row || (target !== userId && (await isBlocked(this.deps.db, userId, target)))) {
      throw new AppError('friends.not_found', 404);
    }
    const looks = await loadLooks(this.deps.db, this.deps.media, [target], userId);
    return {
      userId: target,
      pseudo: row.pseudo,
      avatar: looks.get(target) ?? null,
      relation: target === userId ? 'none' : await this.relation(userId, target),
      self: target === userId,
    };
  }

  /** Demander en ami (par identifiant ou par code). Une demande croisée vaut acceptation. */
  async request(from: { userId: string; pseudo: string }, target: { userId?: string | undefined; code?: string | undefined }): Promise<FriendRequestResult> {
    let toId = target.userId;
    let byCode = false;
    if (target.code) {
      const r = await this.deps.db.query<{ user_id: string }>('SELECT user_id FROM friend_codes WHERE code = $1', [target.code]);
      toId = r.rows[0]?.user_id;
      byCode = true;
    }
    if (!toId) throw new AppError('friends.not_found', 404);
    if (toId === from.userId) throw new AppError('friends.self', 400);
    const row = (await this.players([toId])).get(toId);
    if (!row || (!byCode && !(await this.visible(from.userId, row)))) throw new AppError('friends.not_found', 404);
    if (await isBlocked(this.deps.db, from.userId, toId)) {
      // On ne révèle pas à un joueur qu'il est bloqué : il ne trouve simplement personne.
      const mine = await this.deps.db.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [from.userId, toId]);
      throw (mine.rowCount ?? 0) > 0 ? new AppError('friends.blocked', 403) : new AppError('friends.not_found', 404);
    }
    const current = await this.relation(from.userId, toId);
    if (current === 'friend' || current === 'outgoing') return { userId: toId, relation: current };
    if (current === 'incoming') return this.accept(from, toId);
    const counts = await this.deps.db.query<{ friends: number; pending: number }>(
      `SELECT count(*) FILTER (WHERE status = 'accepted')::int AS friends,
              count(*) FILTER (WHERE status = 'pending' AND requested_by = $1)::int AS pending
         FROM friendships WHERE user_a = $1 OR user_b = $1`,
      [from.userId],
    );
    if ((counts.rows[0]?.friends ?? 0) >= MAX_FRIENDS) throw new AppError('friends.limit', 409, { max: MAX_FRIENDS });
    if ((counts.rows[0]?.pending ?? 0) >= MAX_PENDING_REQUESTS) throw new AppError('friends.too_many_requests', 429, { max: MAX_PENDING_REQUESTS });
    const [a, b] = pairOf(from.userId, toId);
    await transaction(this.deps.db, async (tx) => {
      const ins = await tx.query(
        `INSERT INTO friendships (user_a, user_b, requested_by, status, created_at) VALUES ($1, $2, $3, 'pending', $4)
         ON CONFLICT DO NOTHING`,
        [a, b, from.userId, this.deps.clock.now()],
      );
      if ((ins.rowCount ?? 0) > 0) {
        await this.deps.notifications.notify(tx, toId, 'invites.friend_request', { from: from.pseudo, userId: from.userId });
      }
    });
    return { userId: toId, relation: await this.relation(from.userId, toId) };
  }

  async accept(me: { userId: string; pseudo: string }, otherId: string): Promise<FriendRequestResult> {
    const [a, b] = pairOf(me.userId, otherId);
    const ok = await transaction(this.deps.db, async (tx) => {
      const count = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM friendships WHERE (user_a = $1 OR user_b = $1) AND status = 'accepted'", [me.userId]);
      if ((count.rows[0]?.n ?? 0) >= MAX_FRIENDS) throw new AppError('friends.limit', 409, { max: MAX_FRIENDS });
      const r = await tx.query(
        `UPDATE friendships SET status = 'accepted', accepted_at = $4
          WHERE user_a = $1 AND user_b = $2 AND status = 'pending' AND requested_by <> $3`,
        [a, b, me.userId, this.deps.clock.now()],
      );
      if ((r.rowCount ?? 0) === 0) return false;
      await this.deps.notifications.notify(tx, otherId, 'friends.accepted', { from: me.pseudo, userId: me.userId });
      return true;
    });
    if (!ok) throw new AppError('friends.no_request', 404);
    await this.pushPresence(me.userId, otherId);
    return { userId: otherId, relation: 'friend' };
  }

  /** Refuser une demande reçue, ou annuler une demande envoyée. */
  async decline(userId: string, otherId: string): Promise<void> {
    const [a, b] = pairOf(userId, otherId);
    const r = await this.deps.db.query("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2 AND status = 'pending'", [a, b]);
    if ((r.rowCount ?? 0) === 0) throw new AppError('friends.no_request', 404);
  }

  /** Retirer un ami (sans prévenir). */
  async remove(userId: string, otherId: string): Promise<void> {
    const [a, b] = pairOf(userId, otherId);
    await this.deps.db.query('DELETE FROM friendships WHERE user_a = $1 AND user_b = $2', [a, b]);
  }

  /** Nouveaux amis : chacun reçoit tout de suite la présence de l'autre. */
  private async pushPresence(x: string, y: string): Promise<void> {
    const rows = await this.players([x, y]);
    for (const [to, about] of [[x, y], [y, x]] as const) {
      const online = this.deps.hub.isOnline(about);
      const seen = rows.get(about)?.last_seen_at;
      this.deps.hub.sendToUsers([to], {
        t: 'presence.update',
        users: [{ userId: about, online, lastSeenAt: online || !seen ? null : seen.toISOString() }],
      });
    }
  }
}

/** Audience de présence : les amis acceptés (branché sur app.realtime). */
export function friendsAudience(db: Sql): (userId: string) => Promise<string[]> {
  return (userId) => friendIds(db, userId);
}
