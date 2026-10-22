import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, createWsClient, WS_RECONNECTED, type WebSocketLike, type WsStatus } from './ws';

/** Faux socket : on pilote l'ouverture, les messages et la fermeture depuis le test. */
class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: WebSocketLike['onopen'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
    this.onclose?.({ code });
  }
  // --- pilotage
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  get messages() {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const last = () => FakeSocket.all[FakeSocket.all.length - 1]!;

function makeClient(overrides: Partial<Parameters<typeof createWsClient>[0]> = {}) {
  let n = 0;
  return createWsClient({
    url: 'wss://api.kwatt.test/v1/ws',
    createSocket: (url) => new FakeSocket(url),
    getToken: async () => 'acc-1',
    random: () => 0.5, // pas de hasard : attente = valeur de base
    newId: () => `r${++n}`,
    pingIntervalMs: 25_000,
    ...overrides,
  });
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('attente croissante', () => {
  it('double à chaque essai, plafonnée, avec ± 20 % de hasard', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((a) => backoffDelay(a, undefined, () => 0.5))).toEqual([
      500, 1000, 2000, 4000, 8000, 15000, 15000,
    ]);
    expect(backoffDelay(0, undefined, () => 0)).toBe(400);
    expect(backoffDelay(0, undefined, () => 1)).toBe(600);
  });
});

describe('client temps réel', () => {
  it('se connecte avec le jeton et passe à « open »', async () => {
    const client = makeClient();
    const statuses: WsStatus[] = [];
    client.onStatus((s) => statuses.push(s));
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(last().url).toBe('wss://api.kwatt.test/v1/ws?token=acc-1');
    last().open();
    expect(client.status).toBe('open');
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('garde les messages en file tant que la connexion n’est pas ouverte', async () => {
    const client = makeClient();
    client.send({ t: 'presence.update' });
    client.connect();
    client.send({ t: 'room.join', code: 'ABCDEF' });
    await vi.advanceTimersByTimeAsync(0);
    expect(last().sent).toEqual([]);
    last().open();
    expect(last().messages).toEqual([{ t: 'presence.update' }, { t: 'room.join', code: 'ABCDEF' }]);
  });

  it('distribue les messages par type', async () => {
    const client = makeClient();
    const states: unknown[] = [];
    const all: string[] = [];
    const off = client.on('game.state', (m) => states.push(m.seq));
    client.on('*', (m) => all.push(m.t));
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    last().receive({ t: 'game.state', seq: 1 });
    last().receive({ t: 'notify', id: 'n1' });
    off();
    last().receive({ t: 'game.state', seq: 2 });
    expect(states).toEqual([1]);
    expect(all).toEqual(['game.state', 'notify', 'game.state']);
  });

  it('associe la réponse à la requête par id / re', async () => {
    const client = makeClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    const reply = client.request<{ t: string; re?: string; seats: number }>({ t: 'room.join', code: 'ABCDEF' });
    expect(last().messages.at(-1)).toEqual({ t: 'room.join', code: 'ABCDEF', id: 'r1' });
    last().receive({ t: 'room.joined', re: 'r1', seats: 4 });
    await expect(reply).resolves.toMatchObject({ seats: 4 });
  });

  it('rejette la requête sur une erreur typée', async () => {
    const client = makeClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    const reply = client.request({ t: 'room.join', code: 'ZZZZZZ' });
    last().receive({ t: 'error', re: 'r1', code: 'room.not_found', params: {} });
    await expect(reply).rejects.toMatchObject({ code: 'room.not_found' });
  });

  it('abandonne une requête sans réponse après le délai', async () => {
    const client = makeClient({ requestTimeoutMs: 1000 });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    const reply = client.request({ t: 'game.sync' }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await reply).toMatchObject({ code: 'network.timeout' });
  });

  it('se reconnecte avec une attente croissante et l’annonce', async () => {
    const client = makeClient();
    const reconnected = vi.fn();
    client.on(WS_RECONNECTED, reconnected);
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();

    last().drop();
    expect(client.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(499);
    expect(FakeSocket.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all).toHaveLength(2);

    last().drop(); // l'essai échoue : on attend deux fois plus
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all).toHaveLength(3);

    client.send({ t: 'game.move', move: 'a' });
    last().open();
    expect(client.status).toBe('open');
    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(last().messages).toEqual([{ t: 'game.move', move: 'a' }]);

    last().drop(); // après une connexion réussie, l'attente repart du début
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it('demande un nouveau jeton quand le serveur refuse le sien', async () => {
    let token = 'acc-1';
    const onAuthFailure = vi.fn(async () => {
      token = 'acc-2';
    });
    const client = makeClient({ getToken: async () => token, onAuthFailure });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().drop(4401);
    await vi.advanceTimersByTimeAsync(500);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(last().url).toContain('token=acc-2');
  });

  it('ne se connecte pas sans session', async () => {
    const client = makeClient({ getToken: async () => null });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.all).toHaveLength(0);
    expect(client.status).toBe('closed');
  });

  it('envoie un ping régulier et relance une connexion muette', async () => {
    const client = makeClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    const first = last();
    first.open();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(first.messages).toEqual([{ t: 'ping' }]);
    first.receive({ t: 'pong' });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(first.messages).toEqual([{ t: 'ping' }, { t: 'ping' }]);
    await vi.advanceTimersByTimeAsync(50_000); // plus rien reçu depuis 50 s
    expect(first.closedWith).toBe(4000);
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.all.length).toBeGreaterThan(1);
  });

  it('se ferme pour de bon à la déconnexion et rejette les requêtes en cours', async () => {
    const client = makeClient();
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    const reply = client.request({ t: 'game.sync' }).catch((e: unknown) => e);
    client.disconnect();
    expect(await reply).toMatchObject({ code: 'network.offline' });
    expect(client.status).toBe('closed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
