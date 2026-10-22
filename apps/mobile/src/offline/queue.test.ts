import { describe, expect, it, vi } from 'vitest';
import { memoryStore, STORAGE_KEYS } from '../storage/kv';
import { createOfflineQueue, type QueuedAction, type SendOutcome } from './queue';

function makeQueue(storage = memoryStore(), maxAttempts?: number) {
  let n = 0;
  return createOfflineQueue({ storage, now: () => 1000, newId: () => `a${++n}`, ...(maxAttempts ? { maxAttempts } : {}) });
}

describe('file hors ligne', () => {
  it('garde les actions sur l’appareil, dans l’ordre', async () => {
    const storage = memoryStore();
    const queue = makeQueue(storage);
    await queue.enqueue('machine.result', { gameId: 'g1' });
    await queue.enqueue('machine.result', { gameId: 'g2' });
    expect(queue.size()).toBe(2);

    const reopened = makeQueue(storage);
    await reopened.load();
    expect(reopened.list().map((a) => (a.payload as { gameId: string }).gameId)).toEqual(['g1', 'g2']);
    expect(JSON.parse(storage.dump()[STORAGE_KEYS.offlineQueue]!)).toHaveLength(2);
  });

  it('envoie tout quand le serveur accepte', async () => {
    const queue = makeQueue();
    await queue.enqueue('a', 1);
    await queue.enqueue('b', 2);
    const send = vi.fn(async (_action: QueuedAction): Promise<SendOutcome> => 'done');
    expect(await queue.flush(send)).toEqual({ sent: 2, dropped: 0, remaining: 0 });
    expect(send.mock.calls.map(([a]) => (a as QueuedAction).kind)).toEqual(['a', 'b']);
  });

  it('s’arrête au premier échec temporaire pour garder l’ordre', async () => {
    const queue = makeQueue();
    await queue.enqueue('a', 1);
    await queue.enqueue('b', 2);
    const send = vi.fn(async (a: QueuedAction): Promise<SendOutcome> => (a.kind === 'a' ? 'retry' : 'done'));
    expect(await queue.flush(send)).toEqual({ sent: 0, dropped: 0, remaining: 2 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.list()[0]!.attempts).toBe(1);
  });

  it('attend sans compter d’essai quand l’action n’est pas encore envoyable', async () => {
    const queue = makeQueue();
    await queue.enqueue('module.pas.charge', 1);
    expect(await queue.flush(async () => 'later')).toEqual({ sent: 0, dropped: 0, remaining: 1 });
    expect(queue.list()[0]!.attempts).toBe(0);
  });

  it('compte une exception comme un échec temporaire et note l’erreur', async () => {
    const queue = makeQueue();
    await queue.enqueue('a', 1);
    await queue.flush(async () => {
      throw new Error('network.offline');
    });
    expect(queue.list()[0]).toMatchObject({ attempts: 1, lastError: 'network.offline' });
  });

  it('retire une action refusée pour de bon, ou toujours en échec', async () => {
    const queue = makeQueue(memoryStore(), 2);
    await queue.enqueue('invalide', 1);
    await queue.enqueue('instable', 2);
    await queue.enqueue('ok', 3);
    const send = async (a: QueuedAction): Promise<SendOutcome> => (a.kind === 'invalide' ? 'drop' : a.kind === 'instable' ? 'retry' : 'done');
    expect(await queue.flush(send)).toEqual({ sent: 0, dropped: 1, remaining: 2 });
    expect(await queue.flush(send)).toEqual({ sent: 1, dropped: 1, remaining: 0 });
  });

  it('partage un seul envoi entre appels simultanés', async () => {
    const queue = makeQueue();
    await queue.enqueue('a', 1);
    const send = vi.fn(async (): Promise<SendOutcome> => {
      await new Promise((r) => setTimeout(r, 5));
      return 'done';
    });
    const [r1, r2] = await Promise.all([queue.flush(send), queue.flush(send)]);
    expect(r1).toBe(r2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('prévient les abonnés à chaque changement', async () => {
    const queue = makeQueue();
    const sizes: number[] = [];
    queue.subscribe((a) => sizes.push(a.length));
    await queue.load();
    await queue.enqueue('a', 1);
    await queue.flush(async () => 'done');
    expect(sizes).toEqual([0, 1, 0]);
  });

  it('ignore une file abîmée', async () => {
    const queue = makeQueue(memoryStore({ [STORAGE_KEYS.offlineQueue]: '[{"id":1},{"id":"x","kind":"k","createdAt":1,"attempts":0}]' }));
    await queue.load();
    expect(queue.list().map((a) => a.id)).toEqual(['x']);
  });
});
