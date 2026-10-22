/**
 * Client REST : JSON, jeton d'accès, renouvellement automatique (un seul à la fois),
 * erreurs typées par code. Module pur : `fetch`, la session et l'horloge sont injectés.
 */
import { ApiError, codeForStatus } from './errors';
import { API_PATHS, type ApiErrorBody, type AuthTokens } from './types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
}

export interface RestClientOptions {
  baseUrl: string;
  fetch: typeof fetch;
  /** Jetons courants, ou `null` sans session. */
  getTokens(): SessionTokens | null;
  /** Nouveaux jetons reçus après un renouvellement (à garder). */
  onTokens(tokens: AuthTokens): void | Promise<void>;
  /** Renouvellement refusé : la session est terminée (déconnexion côté appli). */
  onSessionExpired(): void | Promise<void>;
  /** En-têtes communs (langue, identifiant d'installation, version). */
  getHeaders?(): Record<string, string> | Promise<Record<string, string>>;
  /**
   * Corps du renouvellement (POST /v1/auth/refresh) ; par défaut `{ refreshToken }`.
   * Le serveur demande aussi l'appareil (`{ refreshToken, device }`, @kwatt/protocol).
   */
  refreshBody?(refreshToken: string): unknown;
  now?: () => number;
  /** Délai maximal d'une requête (15 s par défaut). */
  timeoutMs?: number;
  /** On renouvelle le jeton d'accès s'il expire dans moins de cette marge (30 s). */
  refreshMarginMs?: number;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Jeton d'accès joint (vrai par défaut). */
  auth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface RestClient {
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  delete<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  /** Renouvelle les jetons (partagé entre appels simultanés). `null` si la session est finie. */
  refresh(): Promise<SessionTokens | null>;
  /** Jeton d'accès valide (renouvelé si besoin), pour le temps réel. */
  getFreshAccessToken(): Promise<string | null>;
}

export function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error = (body as Partial<ApiErrorBody> | null)?.error;
  if (error && typeof error.code === 'string') {
    return new ApiError(error.code, response.status, error.params ?? {});
  }
  return new ApiError(codeForStatus(response.status), response.status);
}

export function createRestClient(options: RestClientOptions): RestClient {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const margin = options.refreshMarginMs ?? 30_000;
  let refreshing: Promise<SessionTokens | null> | null = null;

  /** Envoie une requête et renvoie la réponse brute ; erreurs réseau → ApiError. */
  async function send(method: HttpMethod, path: string, opts: RequestOptions, token: string | null): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(await options.getHeaders?.()),
      ...opts.headers,
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      return await options.fetch(buildUrl(options.baseUrl, path, opts.query), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut) throw new ApiError('network.timeout', 0, {}, { cause });
      if (opts.signal?.aborted) throw cause;
      throw new ApiError('network.offline', 0, {}, { cause });
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function doRefresh(): Promise<SessionTokens | null> {
    const current = options.getTokens();
    if (!current) return null;
    const body = options.refreshBody ? await options.refreshBody(current.refreshToken) : { refreshToken: current.refreshToken };
    const response = await send('POST', API_PATHS.refresh, { body, auth: false }, null);
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      await options.onSessionExpired();
      return null;
    }
    if (!response.ok) throw await parseError(response);
    let tokens: AuthTokens;
    try {
      tokens = (await response.json()) as AuthTokens;
    } catch (cause) {
      throw new ApiError('network.bad_response', response.status, {}, { cause });
    }
    if (typeof tokens?.accessToken !== 'string' || typeof tokens.refreshToken !== 'string') {
      throw new ApiError('network.bad_response', response.status);
    }
    await options.onTokens(tokens);
    return options.getTokens();
  }

  function refresh(): Promise<SessionTokens | null> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function getFreshAccessToken(): Promise<string | null> {
    const tokens = options.getTokens();
    if (!tokens) return null;
    if (tokens.accessExpiresAt - now() > margin) return tokens.accessToken;
    const renewed = await refresh();
    return renewed?.accessToken ?? null;
  }

  async function request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth ?? true;
    let token: string | null = null;
    if (auth && options.getTokens()) {
      token = await getFreshAccessToken();
      // Renouvellement refusé avant même d'envoyer : la session est terminée.
      if (!token) throw new ApiError('auth.session_expired', 401);
    }
    let response = await send(method, path, opts, token);

    if (response.status === 401 && auth && token) {
      // Jeton refusé (révoqué, horloge décalée) : un renouvellement, puis un seul nouvel essai.
      const renewed = await refresh();
      if (!renewed) throw new ApiError('auth.session_expired', 401);
      token = renewed.accessToken;
      response = await send(method, path, opts, token);
      if (response.status === 401) {
        await options.onSessionExpired();
        throw new ApiError('auth.session_expired', 401);
      }
    }

    if (!response.ok) throw await parseError(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new ApiError('network.bad_response', response.status, {}, { cause });
    }
  }

  return {
    request,
    get: (path, o) => request('GET', path, o),
    post: (path, body, o) => request('POST', path, { ...o, body }),
    put: (path, body, o) => request('PUT', path, { ...o, body }),
    patch: (path, body, o) => request('PATCH', path, { ...o, body }),
    delete: (path, o) => request('DELETE', path, o),
    refresh,
    getFreshAccessToken,
  };
}
