/**
 * Temps réel : registre des connexions WebSocket, gestionnaires de messages, envois, présence.
 *
 * - Une connexion par appli ouverte ; un joueur peut en avoir plusieurs (téléphone + tablette).
 * - Chaque module enregistre ses types de messages : `registerHandler('room.join', schema, handler)`.
 *   Le message est validé par le schéma zod avant d'atteindre le gestionnaire.
 * - Les messages d'une connexion sont traités dans l'ordre d'arrivée, un à la fois.
 * - Sujets (`room:ABCDEF`, `game:<id>`) : `subscribe` / `publish` pour diffuser à un salon, une partie.
 * - Ping du protocole WebSocket toutes les 30 s : une connexion qui ne répond pas est coupée.
 * - Présence : en ligne dès la première connexion, hors ligne après un court délai sans
 *   connexion (évite le clignotement lors d'une reconnexion).
 */
import {
  ClientEnvelopeSchema,
  PingMessageSchema,
  WS_CLOSE_CODES,
  type ErrorCode,
  type ErrorParams,
  type Locale,
  type ServerEnvelope,
} from '@kwatt/protocol';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { z } from 'zod';
import type { Clock } from '../lib/clock.js';
import { toAppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export interface ConnectionIdentity {
  userId: string;
  sessionId: string;
  locale: Locale;
}

export interface Connection extends ConnectionIdentity {
  readonly id: string;
  readonly connectedAt: Date;
  readonly socket: WebSocket;
  readonly topics: Set<string>;
  alive: boolean;
}

export interface WsContext<M> {
  /** Message validé. */
  msg: M;
  conn: Connection;
  userId: string;
  log: Logger;
  /** Répond à ce message (`re` = son `id`). */
  reply(message: ServerEnvelope): void;
}

export type WsHandler<M> = (ctx: WsContext<M>) => void | Promise<void>;

interface HandlerEntry {
  schema: z.ZodType;
  fn: WsHandler<unknown>;
}

export type PresenceListener = (userId: string, online: boolean, at: Date) => void | Promise<void>;

/** Joueurs à prévenir quand `userId` se connecte ou se déconnecte (ses amis). */
export type PresenceAudience = (userId: string) => Promise<string[]>;

export interface HubOptions {
  log: Logger;
  clock: Clock;
  pingIntervalMs: number;
  presenceGraceMs: number;
  /** Débit autorisé par connexion : jetons par seconde et réserve. */
  rate?: { perSecond: number; burst: number };
}

/** Seau à jetons d'une connexion. */
interface Bucket {
  tokens: number;
  last: number;
  dropped: number;
}

export class RealtimeHub {
  private readonly handlers = new Map<string, HandlerEntry>();
  private readonly byUser = new Map<string, Set<Connection>>();
  private readonly byTopic = new Map<string, Set<Connection>>();
  private readonly queues = new WeakMap<Connection, Promise<void>>();
  private readonly buckets = new WeakMap<Connection, Bucket>();
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();
  private readonly presenceListeners: PresenceListener[] = [];
  private audience: PresenceAudience | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly rate: { perSecond: number; burst: number };

  constructor(private readonly options: HubOptions) {
    this.rate = options.rate ?? { perSecond: 20, burst: 40 };
    this.registerHandler('ping', PingMessageSchema, ({ reply }) => {
      reply({ t: 'pong', serverTime: this.options.clock.now().getTime() });
    });
  }

  // --- Gestionnaires ---------------------------------------------------------

  /**
   * Enregistre le gestionnaire d'un type de message client.
   * Le schéma valide le message entier (`{ t, id?, ...données }`) : utiliser `clientMessage` de @kwatt/protocol.
   */
  registerHandler<S extends z.ZodType>(type: string, schema: S, fn: WsHandler<z.output<S>>): void {
    if (this.handlers.has(type)) throw new Error(`Gestionnaire WebSocket déjà enregistré : ${type}`);
    this.handlers.set(type, { schema, fn: fn as WsHandler<unknown> });
  }

  hasHandler(type: string): boolean {
    return this.handlers.has(type);
  }

  // --- Connexions -------------------------------------------------------------

  /** Branche une socket authentifiée. */
  attach(socket: WebSocket, identity: ConnectionIdentity): Connection {
    const conn: Connection = {
      ...identity,
      id: randomUUID(),
      connectedAt: this.options.clock.now(),
      socket,
      topics: new Set(),
      alive: true,
    };
    let set = this.byUser.get(conn.userId);
    const wasOnline = set !== undefined && set.size > 0;
    if (!set) {
      set = new Set();
      this.byUser.set(conn.userId, set);
    }
    set.add(conn);
    this.buckets.set(conn, { tokens: this.rate.burst, last: Date.now(), dropped: 0 });

    const pendingOffline = this.offlineTimers.get(conn.userId);
    if (pendingOffline) {
      // Reconnexion pendant le délai de grâce : pas de passage hors ligne.
      clearTimeout(pendingOffline);
      this.offlineTimers.delete(conn.userId);
    } else if (!wasOnline) {
      this.emitPresence(conn.userId, true);
    }

    socket.on('pong', () => {
      conn.alive = true;
    });
    socket.on('message', (data, isBinary) => {
      conn.alive = true;
      this.onMessage(conn, data, isBinary);
    });
    socket.on('close', () => this.detach(conn));
    socket.on('error', (err) => this.options.log.debug({ err, conn: conn.id }, 'erreur WebSocket'));

    this.send(conn, { t: 'hello', userId: conn.userId, connectionId: conn.id, serverTime: this.options.clock.now().getTime() });
    return conn;
  }

  private detach(conn: Connection): void {
    for (const topic of conn.topics) this.unsubscribe(conn, topic);
    const set = this.byUser.get(conn.userId);
    if (!set?.delete(conn)) return;
    if (set.size > 0) return;
    this.byUser.delete(conn.userId);
    const goOffline = () => {
      this.offlineTimers.delete(conn.userId);
      if (!this.byUser.has(conn.userId)) this.emitPresence(conn.userId, false);
    };
    if (this.options.presenceGraceMs <= 0) {
      goOffline();
      return;
    }
    const timer = setTimeout(goOffline, this.options.presenceGraceMs);
    timer.unref();
    this.offlineTimers.set(conn.userId, timer);
  }

  private onMessage(conn: Connection, data: unknown, isBinary: boolean): void {
    if (!this.take(conn)) return;
    if (isBinary) {
      this.sendError(conn, undefined, 'ws.invalid_message');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
    } catch {
      this.sendError(conn, undefined, 'ws.invalid_message');
      return;
    }
    const envelope = ClientEnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      const id = typeof json === 'object' && json !== null && 'id' in json ? (json as { id: unknown }).id : undefined;
      this.sendError(conn, typeof id === 'string' ? id : undefined, 'ws.invalid_message');
      return;
    }
    const { t, id } = envelope.data;
    const entry = this.handlers.get(t);
    if (!entry) {
      this.sendError(conn, id, 'ws.unknown_type', { t });
      return;
    }
    const previous = this.queues.get(conn) ?? Promise.resolve();
    const next = previous.then(() => this.run(conn, entry, json, id));
    this.queues.set(conn, next);
  }

  private async run(conn: Connection, entry: HandlerEntry, json: unknown, id: string | undefined): Promise<void> {
    const parsed = entry.schema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.'), code: i.code }));
      this.sendError(conn, id, 'common.validation', { issues });
      return;
    }
    try {
      await entry.fn({
        msg: parsed.data,
        conn,
        userId: conn.userId,
        log: this.options.log,
        reply: (message) => this.send(conn, id === undefined ? message : { ...message, re: id }),
      });
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.status >= 500) this.options.log.error({ err, t: (json as { t?: unknown }).t }, 'gestionnaire WebSocket en échec');
      this.sendError(conn, id, appErr.code, appErr.params);
    }
  }

  /** Seau à jetons : au-delà du débit, le message est refusé ; un abus prolongé coupe la connexion. */
  private take(conn: Connection): boolean {
    const b = this.buckets.get(conn);
    if (!b) return false;
    const now = Date.now();
    b.tokens = Math.min(this.rate.burst, b.tokens + ((now - b.last) / 1000) * this.rate.perSecond);
    b.last = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    b.dropped++;
    if (b.dropped > 3 * this.rate.burst) conn.socket.close(WS_CLOSE_CODES.tooManyMessages, 'rate_limited');
    else this.sendError(conn, undefined, 'ws.rate_limited');
    return false;
  }

  // --- Envois -------------------------------------------------------------------

  /** Envoie un message à une connexion ; false si elle est fermée. */
  send(conn: Connection, message: ServerEnvelope): boolean {
    if (conn.socket.readyState !== conn.socket.OPEN) return false;
    conn.socket.send(JSON.stringify(message));
    return true;
  }

  sendError(conn: Connection, re: string | undefined, code: ErrorCode, params: ErrorParams = {}): void {
    this.send(conn, re === undefined ? { t: 'error', code, params } : { t: 'error', re, code, params });
  }

  /** Envoie à toutes les connexions d'un joueur ; rend le nombre de connexions atteintes. */
  sendToUser(userId: string, message: ServerEnvelope): number {
    let n = 0;
    for (const conn of this.byUser.get(userId) ?? []) if (this.send(conn, message)) n++;
    return n;
  }

  /** Envoie à plusieurs joueurs. */
  sendToUsers(userIds: Iterable<string>, message: ServerEnvelope): number {
    let n = 0;
    for (const id of new Set(userIds)) n += this.sendToUser(id, message);
    return n;
  }

  /** Envoie à toutes les connexions (éventuellement filtrées). */
  broadcast(message: ServerEnvelope, filter?: (conn: Connection) => boolean): number {
    let n = 0;
    for (const set of this.byUser.values()) {
      for (const conn of set) if ((!filter || filter(conn)) && this.send(conn, message)) n++;
    }
    return n;
  }

  // --- Sujets (salon, partie) ------------------------------------------------------

  subscribe(conn: Connection, topic: string): void {
    conn.topics.add(topic);
    let set = this.byTopic.get(topic);
    if (!set) {
      set = new Set();
      this.byTopic.set(topic, set);
    }
    set.add(conn);
  }

  unsubscribe(conn: Connection, topic: string): void {
    conn.topics.delete(topic);
    const set = this.byTopic.get(topic);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.byTopic.delete(topic);
  }

  /** Abonne toutes les connexions d'un joueur à un sujet. */
  subscribeUser(userId: string, topic: string): void {
    for (const conn of this.byUser.get(userId) ?? []) this.subscribe(conn, topic);
  }

  unsubscribeUser(userId: string, topic: string): void {
    for (const conn of [...(this.byUser.get(userId) ?? [])]) this.unsubscribe(conn, topic);
  }

  /** Diffuse aux abonnés d'un sujet ; rend le nombre de connexions atteintes. */
  publish(topic: string, message: ServerEnvelope, except?: Connection): number {
    let n = 0;
    for (const conn of this.byTopic.get(topic) ?? []) if (conn !== except && this.send(conn, message)) n++;
    return n;
  }

  subscribers(topic: string): Connection[] {
    return [...(this.byTopic.get(topic) ?? [])];
  }

  // --- Présence ---------------------------------------------------------------------

  isOnline(userId: string): boolean {
    return this.byUser.has(userId) || this.offlineTimers.has(userId);
  }

  onlineUserIds(): string[] {
    return [...new Set([...this.byUser.keys(), ...this.offlineTimers.keys()])];
  }

  connectionsOf(userId: string): Connection[] {
    return [...(this.byUser.get(userId) ?? [])];
  }

  /** Sessions qui ont au moins une connexion ouverte. */
  sessionIds(): string[] {
    const ids = new Set<string>();
    for (const set of this.byUser.values()) for (const conn of set) ids.add(conn.sessionId);
    return [...ids];
  }

  connectionCount(): number {
    let n = 0;
    for (const set of this.byUser.values()) n += set.size;
    return n;
  }

  /** Crochet appelé à chaque passage en ligne / hors ligne (mise à jour en base, amis prévenus…). */
  onPresenceChange(listener: PresenceListener): void {
    this.presenceListeners.push(listener);
  }

  /**
   * Crochet pour le module Amis : qui prévenir (message `presence.update`) quand un joueur
   * se connecte ou se déconnecte. Par défaut : personne.
   */
  setPresenceAudience(audience: PresenceAudience | null): void {
    this.audience = audience;
  }

  presenceAudience(userId: string): Promise<string[]> {
    return this.audience ? this.audience(userId) : Promise.resolve([]);
  }

  private emitPresence(userId: string, online: boolean): void {
    const at = this.options.clock.now();
    for (const listener of this.presenceListeners) {
      Promise.resolve()
        .then(() => listener(userId, online, at))
        .catch((err: unknown) => this.options.log.error({ err }, 'crochet de présence en échec'));
    }
  }

  // --- Fermetures ---------------------------------------------------------------------

  /** Ferme les connexions d'une session (déconnexion, session révoquée). */
  closeSession(sessionId: string, code: number = WS_CLOSE_CODES.sessionRevoked): void {
    for (const set of this.byUser.values()) {
      for (const conn of [...set]) if (conn.sessionId === sessionId) conn.socket.close(code, 'session_revoked');
    }
  }

  /** Ferme toutes les connexions d'un joueur. */
  closeUser(userId: string, code: number = WS_CLOSE_CODES.sessionRevoked): void {
    for (const conn of [...(this.byUser.get(userId) ?? [])]) conn.socket.close(code, 'session_revoked');
  }

  // --- Cycle de vie --------------------------------------------------------------------

  /** Démarre le ping périodique (coupe les connexions mortes). */
  start(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.sweep(), this.options.pingIntervalMs);
    this.heartbeat.unref();
  }

  /** Un tour de contrôle : coupe ce qui n'a pas répondu au ping précédent, puis pinge. */
  sweep(): void {
    for (const set of this.byUser.values()) {
      for (const conn of [...set]) {
        if (!conn.alive) {
          conn.socket.terminate();
          continue;
        }
        conn.alive = false;
        try {
          conn.socket.ping();
        } catch {
          conn.socket.terminate();
        }
      }
    }
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const timer of this.offlineTimers.values()) clearTimeout(timer);
    this.offlineTimers.clear();
    for (const set of this.byUser.values()) {
      for (const conn of [...set]) conn.socket.close(WS_CLOSE_CODES.serverShutdown, 'server_shutdown');
    }
  }
}
