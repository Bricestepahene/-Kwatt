/**
 * Client temps réel (SPEC §9) : une connexion par appli, `GET /v1/ws?token=…`.
 * - reconnexion automatique avec attente croissante (et un peu de hasard) ;
 * - abonnement par type de message (`on('game.state', …)`) ;
 * - requête / réponse par `id` ↔ `re` ;
 * - file d'envoi pendant la (re)connexion ;
 * - ping régulier, connexion morte détectée et relancée.
 * Module pur : la fabrique de sockets, les minuteries et le hasard sont injectables.
 */
import { ApiError } from './errors';
import type { WsClientMessage, WsErrorMessage, WsServerMessage } from './types';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Sous-ensemble de l'API WebSocket du navigateur et de React Native. */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface BackoffConfig {
  initialMs: number;
  maxMs: number;
  factor: number;
  /** Part de hasard, ± (0,2 = ± 20 %). */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { initialMs: 500, maxMs: 15_000, factor: 2, jitter: 0.2 };

/** Attente avant la tentative n° `attempt` (0, 1, 2…). */
export function backoffDelay(attempt: number, config: BackoffConfig = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const base = Math.min(config.maxMs, config.initialMs * config.factor ** Math.max(0, attempt));
  const spread = base * config.jitter * (random() * 2 - 1);
  return Math.max(0, Math.round(base + spread));
}

/** Fermetures envoyées par le serveur quand le jeton est refusé (convention de l'appli). */
export const WS_AUTH_CLOSE_CODES = [4401, 4403] as const;

/** Message synthétique émis après une reconnexion : les écrans redemandent leur état (`game.sync`). */
export const WS_RECONNECTED = 'ws.reconnected';

export interface WsClientOptions {
  url: string;
  createSocket: (url: string) => WebSocketLike;
  /** Jeton d'accès valide (renouvelé au besoin) ; `null` : pas de session, on ne se connecte pas. */
  getToken(): Promise<string | null>;
  /** Le serveur a refusé le jeton (fermeture 4401/4403). */
  onAuthFailure?(): void | Promise<void>;
  backoff?: BackoffConfig;
  random?: () => number;
  pingIntervalMs?: number;
  requestTimeoutMs?: number;
  maxQueue?: number;
  newId?: () => string;
}

type Handler = (message: WsServerMessage) => void;

interface Pending {
  resolve(message: WsServerMessage): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WsClient {
  readonly status: WsStatus;
  connect(): void;
  /** Ferme et n'essaie plus (déconnexion du joueur) ; vide la file. */
  disconnect(): void;
  /** Reconnecte tout de suite (retour du réseau, appli au premier plan). */
  reconnectNow(): void;
  onStatus(listener: (status: WsStatus) => void): () => void;
  /** Abonnement à un type de message (`'*'` : tous). */
  on<T extends WsServerMessage = WsServerMessage>(type: string, handler: (message: T) => void): () => void;
  /** Envoie, ou met en file si la connexion n'est pas ouverte. */
  send(message: WsClientMessage): void;
  /** Envoie avec un `id` et attend la réponse `re` (ou une erreur `{ t: 'error', re }`). */
  request<T extends WsServerMessage = WsServerMessage>(message: Omit<WsClientMessage, 'id'>, options?: { timeoutMs?: number }): Promise<T>;
}

const OPEN = 1;

export function createWsClient(options: WsClientOptions): WsClient {
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const random = options.random ?? Math.random;
  const pingIntervalMs = options.pingIntervalMs ?? 25_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const maxQueue = options.maxQueue ?? 200;
  let counter = 0;
  const newId = options.newId ?? (() => `c${Date.now().toString(36)}${(counter++).toString(36)}`);

  let status: WsStatus = 'idle';
  let socket: WebSocketLike | null = null;
  let wanted = false;
  let attempt = 0;
  let everOpened = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let lastMessageAt = 0;
  let generation = 0;

  const queue: string[] = [];
  const handlers = new Map<string, Set<Handler>>();
  const statusListeners = new Set<(s: WsStatus) => void>();
  const pending = new Map<string, Pending>();

  function setStatus(next: WsStatus) {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener(next);
  }

  function emit(message: WsServerMessage) {
    for (const key of [message.t, '*']) {
      const set = handlers.get(key);
      if (set) for (const handler of [...set]) handler(message);
    }
  }

  function stopPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (!socket || socket.readyState !== OPEN) return;
      // Rien reçu depuis deux intervalles : connexion morte, on relance.
      if (Date.now() - lastMessageAt > pingIntervalMs * 2) {
        socket.close(4000, 'ping timeout');
        return;
      }
      socket.send(JSON.stringify({ t: 'ping' }));
    }, pingIntervalMs);
  }

  function flushQueue() {
    while (queue.length > 0 && socket && socket.readyState === OPEN) {
      socket.send(queue.shift()!);
    }
  }

  function scheduleReconnect() {
    if (!wanted || reconnectTimer) return;
    setStatus('reconnecting');
    const delay = backoffDelay(attempt, backoff, random);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void open();
    }, delay);
  }

  function handleMessage(raw: unknown) {
    lastMessageAt = Date.now();
    if (typeof raw !== 'string') return;
    let message: WsServerMessage;
    try {
      message = JSON.parse(raw) as WsServerMessage;
    } catch {
      return;
    }
    if (!message || typeof message.t !== 'string') return;

    if (message.re && pending.has(message.re)) {
      const p = pending.get(message.re)!;
      pending.delete(message.re);
      clearTimeout(p.timer);
      if (message.t === 'error') {
        const err = message as WsErrorMessage;
        p.reject(new ApiError(err.code ?? 'generic', 400, err.params ?? {}));
      } else {
        p.resolve(message);
      }
    }
    if (message.t === 'pong') return;
    emit(message);
  }

  async function open() {
    if (!wanted) return;
    const myGeneration = ++generation;
    setStatus(everOpened ? 'reconnecting' : 'connecting');
    let token: string | null;
    try {
      token = await options.getToken();
    } catch {
      // Pas de réseau pour renouveler le jeton : on réessaiera.
      if (myGeneration === generation) scheduleReconnect();
      return;
    }
    if (!wanted || myGeneration !== generation) return;
    if (!token) {
      wanted = false;
      setStatus('closed');
      return;
    }
    const separator = options.url.includes('?') ? '&' : '?';
    let ws: WebSocketLike;
    try {
      ws = options.createSocket(`${options.url}${separator}token=${encodeURIComponent(token)}`);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws) return;
      const wasReconnect = everOpened;
      everOpened = true;
      attempt = 0;
      lastMessageAt = Date.now();
      setStatus('open');
      flushQueue();
      startPing();
      if (wasReconnect) emit({ t: WS_RECONNECTED });
    };
    ws.onmessage = (event) => {
      if (socket === ws) handleMessage(event.data);
    };
    ws.onerror = () => {
      // La fermeture suit toujours une erreur : on attend onclose.
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      stopPing();
      if (!wanted) {
        setStatus('closed');
        return;
      }
      if ((WS_AUTH_CLOSE_CODES as readonly number[]).includes(event.code)) {
        void Promise.resolve(options.onAuthFailure?.()).finally(scheduleReconnect);
        return;
      }
      scheduleReconnect();
    };
  }

  function clearReconnectTimer() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function send(message: WsClientMessage) {
    const data = JSON.stringify(message);
    if (socket && socket.readyState === OPEN) {
      socket.send(data);
      return;
    }
    if (queue.length >= maxQueue) queue.shift();
    queue.push(data);
  }

  return {
    get status() {
      return status;
    },
    connect() {
      if (wanted) return;
      wanted = true;
      attempt = 0;
      void open();
    },
    disconnect() {
      wanted = false;
      generation += 1;
      clearReconnectTimer();
      stopPing();
      queue.length = 0;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new ApiError('network.offline', 0));
        pending.delete(id);
      }
      const ws = socket;
      socket = null;
      everOpened = false;
      ws?.close(1000, 'bye');
      setStatus('closed');
    },
    reconnectNow() {
      if (!wanted) return;
      if (socket && socket.readyState === OPEN) return;
      clearReconnectTimer();
      attempt = 0;
      void open();
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    on(type, handler) {
      const set = handlers.get(type) ?? new Set<Handler>();
      set.add(handler as Handler);
      handlers.set(type, set);
      return () => {
        set.delete(handler as Handler);
      };
    },
    send,
    request<T extends WsServerMessage>(message: Omit<WsClientMessage, 'id'>, opts: { timeoutMs?: number } = {}) {
      const id = newId();
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ApiError('network.timeout', 0));
        }, opts.timeoutMs ?? requestTimeoutMs);
        pending.set(id, { resolve: resolve as (m: WsServerMessage) => void, reject, timer });
        send({ ...message, id } as WsClientMessage);
      });
    },
  };
}
