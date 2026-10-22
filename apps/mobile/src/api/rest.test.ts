import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorMessage, isApiError } from './errors';
import { buildUrl, createRestClient, type SessionTokens } from './rest';
import type { AuthTokens } from './types';
import { createI18n, dynamicTranslator } from '../i18n/setup';

const NOW = 1_800_000_000_000;

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface Harness {
  tokens: SessionTokens | null;
  expired: number;
  calls: Array<{ url: string; init: RequestInit }>;
}

/** Faux serveur : `handler` reçoit l'URL, l'appel et le jeton présenté. */
function setup(handler: (url: string, init: RequestInit, auth: string | null) => Response | Promise<Response>) {
  const h: Harness = {
    tokens: { accessToken: 'acc-1', refreshToken: 'ref-1', accessExpiresAt: NOW + 10 * 60_000 },
    expired: 0,
    calls: [],
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    h.calls.push({ url, init });
    const headers = (init.headers ?? {}) as Record<string, string>;
    return handler(url, init, headers.Authorization ?? null);
  });
  const client = createRestClient({
    baseUrl: 'https://api.kwatt.test/',
    fetch: fetchMock as unknown as typeof fetch,
    getTokens: () => h.tokens,
    onTokens: (t: AuthTokens) => {
      h.tokens = { accessToken: t.accessToken, refreshToken: t.refreshToken, accessExpiresAt: NOW + (t.expiresIn ?? 900) * 1000 };
    },
    onSessionExpired: () => {
      h.expired += 1;
      h.tokens = null;
    },
    getHeaders: () => ({ 'Accept-Language': 'fr', 'X-Install-Id': 'install-1' }),
    now: () => NOW,
  });
  return { h, client, fetchMock };
}

describe('client REST', () => {
  it('construit les URL avec la requête', () => {
    expect(buildUrl('https://a.test/', '/v1/rooms', { limit: 20, cursor: undefined, open: true })).toBe(
      'https://a.test/v1/rooms?limit=20&open=true',
    );
    expect(buildUrl('https://a.test', 'v1/me')).toBe('https://a.test/v1/me');
  });

  it('envoie le JSON, le jeton et les en-têtes communs', async () => {
    const { client, h } = setup(() => json(200, { ok: true }));
    const result = await client.post<{ ok: boolean }>('/v1/rooms', { game: 'dames' });
    expect(result).toEqual({ ok: true });
    const call = h.calls[0]!;
    expect(call.url).toBe('https://api.kwatt.test/v1/rooms');
    expect(call.init.method).toBe('POST');
    expect(call.init.body).toBe('{"game":"dames"}');
    expect(call.init.headers).toMatchObject({
      Authorization: 'Bearer acc-1',
      'Content-Type': 'application/json',
      'Accept-Language': 'fr',
      'X-Install-Id': 'install-1',
    });
  });

  it('envoie un FormData tel quel, sans en-tête JSON (photo de profil)', async () => {
    const { h, client } = setup(() => json(200, { ok: true }));
    const form = new FormData();
    form.append('photo', new Blob(['x'], { type: 'image/jpeg' }), 'photo.jpg');
    await client.post('/v1/me/photo', form);
    const call = h.calls[0];
    expect(call?.init.body).toBe(form);
    expect((call?.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((call?.init.headers as Record<string, string>).Authorization).toBe('Bearer acc-1');
  });

  it('renvoie undefined pour 204', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));
    await expect(client.delete('/v1/friends/u2')).resolves.toBeUndefined();
  });

  it('transforme le corps d’erreur en ApiError typée', async () => {
    const { client } = setup(() => json(409, { error: { code: 'room.full', params: { seats: 4 } } }));
    const error = await client.get('/v1/rooms/ABCDEF').catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'room.full', status: 409, params: { seats: 4 } });
  });

  it('donne un code de repli selon le statut', async () => {
    const { client } = setup(() => new Response('oups', { status: 503 }));
    await expect(client.get('/v1/x')).rejects.toMatchObject({ code: 'network.server', status: 503, isTransient: true });
  });

  it('signale l’absence de réseau', async () => {
    const { client } = setup(() => {
      throw new TypeError('Network request failed');
    });
    await expect(client.get('/v1/x')).rejects.toMatchObject({ code: 'network.offline', status: 0 });
  });

  describe('délai dépassé', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('abandonne après le délai et le dit', async () => {
      const { client } = setup(
        (_url, init) =>
          new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const pending = client.get('/v1/slow').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await pending).toMatchObject({ code: 'network.timeout' });
    });
  });

  it('renouvelle le jeton refusé puis rejoue la requête une fois', async () => {
    const { client, h } = setup((url, _init, auth) => {
      if (url.endsWith('/v1/auth/refresh')) return json(200, { accessToken: 'acc-2', refreshToken: 'ref-2', expiresIn: 900 });
      return auth === 'Bearer acc-2' ? json(200, { me: 'brice' }) : json(401, { error: { code: 'auth.token_expired' } });
    });
    await expect(client.get('/v1/me')).resolves.toEqual({ me: 'brice' });
    expect(h.tokens?.accessToken).toBe('acc-2');
    expect(h.calls.map((c) => c.url.replace('https://api.kwatt.test', ''))).toEqual(['/v1/me', '/v1/auth/refresh', '/v1/me']);
    const refreshCall = h.calls[1]!;
    expect(refreshCall.init.body).toBe('{"refreshToken":"ref-1"}');
    expect((refreshCall.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('ne lance qu’un seul renouvellement pour des requêtes simultanées', async () => {
    let refreshes = 0;
    const { client, h } = setup(async (url, _init, auth) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        return json(200, { accessToken: 'acc-2', refreshToken: 'ref-2', expiresIn: 900 });
      }
      return auth === 'Bearer acc-2' ? json(200, { url }) : json(401, {});
    });
    const results = await Promise.all([client.get('/v1/a'), client.get('/v1/b'), client.get('/v1/c')]);
    expect(results).toHaveLength(3);
    expect(refreshes).toBe(1);
    expect(h.tokens?.refreshToken).toBe('ref-2');
  });

  it('renouvelle d’avance un jeton qui expire dans moins de 30 s', async () => {
    const { client, h } = setup((url, _init, auth) => {
      if (url.endsWith('/v1/auth/refresh')) return json(200, { accessToken: 'acc-2', refreshToken: 'ref-2', expiresIn: 900 });
      return json(200, { auth });
    });
    h.tokens = { accessToken: 'acc-1', refreshToken: 'ref-1', accessExpiresAt: NOW + 10_000 };
    await expect(client.get('/v1/me')).resolves.toEqual({ auth: 'Bearer acc-2' });
    expect(h.calls).toHaveLength(2);
  });

  it('termine la session si le renouvellement est refusé', async () => {
    const { client, h } = setup((url) =>
      url.endsWith('/v1/auth/refresh') ? json(401, { error: { code: 'auth.refresh_reused' } }) : json(401, {}),
    );
    await expect(client.get('/v1/me')).rejects.toMatchObject({ code: 'auth.session_expired', status: 401 });
    expect(h.expired).toBe(1);
    expect(h.tokens).toBeNull();
  });

  it('ne déconnecte pas quand le renouvellement échoue faute de réseau', async () => {
    const { client, h } = setup((url) => {
      if (url.endsWith('/v1/auth/refresh')) throw new TypeError('offline');
      return json(401, {});
    });
    await expect(client.get('/v1/me')).rejects.toMatchObject({ code: 'network.offline' });
    expect(h.expired).toBe(0);
    expect(h.tokens).not.toBeNull();
  });

  it('n’envoie pas de jeton pour une requête publique', async () => {
    const { client, h } = setup(() => json(200, {}));
    await client.post('/v1/auth/guest', { installId: 'x' }, { auth: false });
    expect((h.calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('messages d’erreur', () => {
  it('traduit le code, avec repli sur le message générique', () => {
    const fr = dynamicTranslator(createI18n('fr'));
    const en = dynamicTranslator(createI18n('en'));
    expect(errorMessage(fr, new ApiError('room.full', 409))).toBe('Salon plein : tu peux regarder à la place.');
    expect(errorMessage(en, new ApiError('room.full', 409))).toBe('The room is full: you can watch instead.');
    expect(errorMessage(en, new ApiError('code.inconnu', 400))).toBe('Something went wrong. Try again.');
    expect(errorMessage(fr, new Error('boom'))).toBe("Quelque chose n'a pas marché. Réessaie.");
  });
});
