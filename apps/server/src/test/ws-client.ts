/**
 * Client WebSocket de test : garde tous les messages reçus et permet d'attendre le suivant
 * d'un type donné.
 *
 *   const ws = await TestWsClient.connect(t.wsUrl(token));
 *   ws.send({ t: 'ping', id: '1' });
 *   const pong = await ws.next('pong');
 */
import WebSocket from 'ws';

export type WsMessage = { t: string; re?: string } & Record<string, unknown>;

interface Waiter {
  match: (m: WsMessage) => boolean;
  resolve: (m: WsMessage) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class WsConnectError extends Error {
  constructor(readonly status: number) {
    super(`connexion WebSocket refusée (HTTP ${status})`);
  }
}

export class TestWsClient {
  readonly messages: WsMessage[] = [];
  private readonly waiters: Waiter[] = [];
  private cursor = 0;
  readonly closed: Promise<{ code: number; reason: string }>;

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const m = JSON.parse(String(data)) as WsMessage;
      this.messages.push(m);
      const i = this.waiters.findIndex((w) => w.match(m));
      if (i >= 0) {
        const [w] = this.waiters.splice(i, 1);
        if (w) {
          clearTimeout(w.timer);
          this.cursor = this.messages.length;
          w.resolve(m);
        }
      }
    });
    this.closed = new Promise((resolve) => {
      socket.on('close', (code, reason) => {
        for (const w of this.waiters.splice(0)) {
          clearTimeout(w.timer);
          w.reject(new Error(`connexion fermée (${code}) en attendant un message`));
        }
        resolve({ code, reason: reason.toString() });
      });
    });
  }

  /** Ouvre la connexion ; rejette avec WsConnectError si le serveur refuse (401…). */
  static connect(url: string): Promise<TestWsClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const client = new TestWsClient(socket);
      socket.once('open', () => resolve(client));
      socket.once('unexpected-response', (_req, res) => {
        reject(new WsConnectError(res.statusCode ?? 0));
        socket.terminate();
      });
      socket.once('error', (err) => reject(err));
    });
  }

  send(message: Record<string, unknown> | string): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /**
   * Prochain message (après le dernier rendu) qui correspond : un type `t`, ou un prédicat.
   * Rejette après `timeoutMs`.
   */
  next(match: string | ((m: WsMessage) => boolean), timeoutMs = 3000): Promise<WsMessage> {
    const fn = typeof match === 'string' ? (m: WsMessage) => m.t === match : match;
    for (let i = this.cursor; i < this.messages.length; i++) {
      const m = this.messages[i];
      if (m && fn(m)) {
        this.cursor = i + 1;
        return Promise.resolve(m);
      }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`aucun message ${typeof match === 'string' ? match : 'attendu'} en ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.push({ match: fn, resolve, reject, timer });
    });
  }

  /** true si un message correspondant est arrivé (sans attendre). */
  has(match: string | ((m: WsMessage) => boolean)): boolean {
    const fn = typeof match === 'string' ? (m: WsMessage) => m.t === match : match;
    return this.messages.some(fn);
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    this.socket.close();
    await this.closed;
  }
}
