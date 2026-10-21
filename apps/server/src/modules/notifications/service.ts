/**
 * Notifications (service) : `notify(db, userId, kind, params)`
 *   1. insère la notification (dans la transaction de l'appelant si on lui en passe une) ;
 *   2. après validation : message WebSocket `notify` à toutes les connexions du joueur ;
 *   3. push Expo, rendu dans la langue du destinataire, si ses réglages le permettent
 *      et s'il n'a pas l'appli ouverte (mode 'auto', par défaut).
 *
 * Exemple (module Salons) :
 *   await app.notifications.notify(tx, friendId, 'invites.room', { from: pseudo, code: 'ABCDEF' });
 */
import {
  EXPO_PUSH_TOKEN_PATTERN,
  NotificationKindSchema,
  notificationCategory,
  type Locale,
  type Notification,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from '@kwatt/protocol';
import { afterCommit, type Pool, type Sql } from '../../db/pool.js';
import { hasKey, t, type I18nParams } from '../../i18n/index.js';
import type { Clock } from '../../lib/clock.js';
import { decodeCursor, pageOf } from '../../lib/cursor.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { RealtimeHub } from '../../realtime/hub.js';
import type { PushMessage, PushSender } from './push.js';

export type PushMode = 'auto' | 'always' | 'never';

export interface NotifyOptions {
  /** auto : push seulement si le joueur n'est pas connecté ; always : push quand même ; never : pas de push. */
  push?: PushMode;
}

interface NotificationRow {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  created_at: Date;
  read_at: Date | null;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = { turn: true, invites: true, league: true };

function toNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    kind: r.kind,
    params: r.params,
    createdAt: r.created_at.toISOString(),
    readAt: r.read_at ? r.read_at.toISOString() : null,
  };
}

/** Paramètres simples (texte, nombre) utilisables dans un texte de push. */
function textParams(params: Record<string, unknown>): I18nParams {
  const out: I18nParams = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  return out;
}

export interface NotificationDeps {
  db: Pool;
  hub: RealtimeHub;
  push: PushSender;
  pushEnabled: boolean;
  clock: Clock;
  log: Logger;
}

export class NotificationService {
  constructor(private readonly deps: NotificationDeps) {}

  /**
   * Crée une notification et la livre après validation de la transaction.
   * `kind` : '<catégorie>.<nom>' (turn.*, invites.*, league.*, sinon générale) ;
   * `params` : valeurs JSON traduites par l'appli (jamais de phrase).
   */
  async notify(
    db: Sql,
    userId: string,
    kind: string,
    params: Record<string, unknown> = {},
    options: NotifyOptions = {},
  ): Promise<Notification> {
    if (!NotificationKindSchema.safeParse(kind).success) throw new Error(`Type de notification invalide : ${kind}`);
    const r = await db.query<NotificationRow>(
      `INSERT INTO notifications (user_id, kind, params, created_at) VALUES ($1, $2, $3, $4)
       RETURNING id, kind, params, created_at, read_at`,
      [userId, kind, JSON.stringify(params), this.deps.clock.now()],
    );
    const row = r.rows[0];
    if (!row) throw new Error('insertion de notification sans résultat');
    const notification = toNotification(row);
    afterCommit(db, () => this.deliver(userId, notification, options.push ?? 'auto'), this.deps.log);
    return notification;
  }

  private async deliver(userId: string, n: Notification, mode: PushMode): Promise<void> {
    const unreadCount = await this.unreadCount(userId);
    this.deps.hub.sendToUser(userId, { t: 'notify', notification: n, unreadCount });
    if (mode === 'never' || (mode === 'auto' && this.deps.hub.isOnline(userId))) return;
    await this.pushTo(userId, n, unreadCount);
  }

  /** Envoie le push d'une notification à tous les appareils du joueur (selon ses réglages). */
  async pushTo(userId: string, n: Pick<Notification, 'id' | 'kind' | 'params'>, badge?: number): Promise<number> {
    if (!this.deps.pushEnabled) return 0;
    const category = notificationCategory(n.kind);
    const info = await this.deps.db.query<{ locale: Locale; erased: boolean } & NotificationPreferences>(
      `SELECT u.locale, (u.erased_at IS NOT NULL OR u.delete_requested_at IS NOT NULL) AS erased,
              COALESCE(p.turn, true) AS turn, COALESCE(p.invites, true) AS invites, COALESCE(p.league, true) AS league
         FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    const user = info.rows[0];
    if (!user || user.erased) return 0;
    if (category !== 'general' && !user[category]) return 0;

    const tokens = await this.deps.db.query<{ token: string }>(
      'SELECT token FROM push_tokens WHERE user_id = $1 AND disabled_at IS NULL',
      [userId],
    );
    if (tokens.rows.length === 0) return 0;

    const key = hasKey(user.locale, `push.${n.kind}.title`) ? `push.${n.kind}` : 'push.default';
    const params = textParams(n.params);
    const title = t(user.locale, `${key}.title`, params);
    const body = t(user.locale, `${key}.body`, params);
    const messages: PushMessage[] = tokens.rows.map((r) => ({
      to: r.token,
      title,
      body,
      data: { notificationId: n.id, kind: n.kind, params: n.params },
      sound: 'default',
      priority: category === 'turn' ? 'high' : 'default',
      channelId: category === 'general' ? 'default' : category,
      ...(badge !== undefined ? { badge } : {}),
    }));
    const tickets = await this.deps.push.send(messages);
    const now = this.deps.clock.now();
    const dead: string[] = [];
    const ok: string[] = [];
    tickets.forEach((ticket, i) => {
      const token = messages[i]?.to;
      if (token === undefined) return;
      if (ticket.status === 'ok') ok.push(token);
      else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(token);
    });
    if (dead.length > 0) {
      await this.deps.db.query('UPDATE push_tokens SET disabled_at = $2 WHERE token = ANY($1)', [dead, now]);
    }
    if (ok.length > 0) {
      await this.deps.db.query('UPDATE push_tokens SET last_used_at = $2 WHERE token = ANY($1)', [ok, now]);
    }
    return ok.length;
  }

  async unreadCount(userId: string): Promise<number> {
    const r = await this.deps.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return r.rows[0]?.n ?? 0;
  }

  async list(userId: string, cursor: string | undefined, limit: number) {
    const pos = decodeCursor(cursor);
    const r = await this.deps.db.query<NotificationRow>(
      `SELECT id, kind, params, created_at, read_at FROM notifications
        WHERE user_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
        ORDER BY created_at DESC, id DESC LIMIT $4`,
      [userId, pos?.at ?? null, pos?.id ?? null, limit + 1],
    );
    const page = pageOf(r.rows, limit, (row) => ({ at: row.created_at, id: row.id }));
    return { items: page.items.map(toNotification), nextCursor: page.nextCursor, unreadCount: await this.unreadCount(userId) };
  }

  async markRead(userId: string, ids: string[] | undefined, all: boolean): Promise<number> {
    const now = this.deps.clock.now();
    if (all) {
      await this.deps.db.query('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL', [userId, now]);
    } else if (ids && ids.length > 0) {
      await this.deps.db.query(
        'UPDATE notifications SET read_at = $3 WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL',
        [userId, ids, now],
      );
    }
    return this.unreadCount(userId);
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const r = await this.deps.db.query<NotificationPreferences>(
      'SELECT turn, invites, league FROM notification_preferences WHERE user_id = $1',
      [userId],
    );
    return r.rows[0] ?? { ...DEFAULT_PREFERENCES };
  }

  async updatePreferences(userId: string, patch: NotificationPreferencesPatch): Promise<NotificationPreferences> {
    const current = await this.getPreferences(userId);
    const next: NotificationPreferences = {
      turn: patch.turn ?? current.turn,
      invites: patch.invites ?? current.invites,
      league: patch.league ?? current.league,
    };
    await this.deps.db.query(
      `INSERT INTO notification_preferences (user_id, turn, invites, league, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET turn = $2, invites = $3, league = $4, updated_at = $5`,
      [userId, next.turn, next.invites, next.league, this.deps.clock.now()],
    );
    return next;
  }

  /** Enregistre le jeton push de l'appareil ; un jeton repris par un autre compte change de titulaire. */
  async registerPushToken(userId: string, deviceId: string | null, token: string): Promise<void> {
    if (!EXPO_PUSH_TOKEN_PATTERN.test(token)) throw new AppError('push.token_invalid', 400);
    await this.deps.db.query(
      `INSERT INTO push_tokens (token, user_id, device_id, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET user_id = $2, device_id = $3, disabled_at = NULL, created_at = $4`,
      [token, userId, deviceId, this.deps.clock.now()],
    );
  }

  async removePushToken(userId: string, token: string): Promise<void> {
    await this.deps.db.query('UPDATE push_tokens SET disabled_at = $3 WHERE token = $1 AND user_id = $2', [
      token,
      userId,
      this.deps.clock.now(),
    ]);
  }

  /** Coupe les push d'un joueur (sur un appareil, ou partout) : déconnexion, suppression du compte. */
  async disablePushTokens(db: Sql, userId: string, deviceId?: string): Promise<void> {
    await db.query(
      `UPDATE push_tokens SET disabled_at = $3
        WHERE user_id = $1 AND disabled_at IS NULL AND ($2::uuid IS NULL OR device_id = $2)`,
      [userId, deviceId ?? null, this.deps.clock.now()],
    );
  }
}
