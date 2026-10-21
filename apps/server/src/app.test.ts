import { ApiErrorSchema, HealthResponseSchema } from '@kwatt/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';
import { buildTestApp, type TestApp } from './test/helpers.js';

describe('configuration', () => {
  const base = { DATABASE_URL: 'postgres://x@localhost/x' };

  it('exige les secrets en production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'court', JWT_REFRESH_SECRET: 'court' })).toThrow(
      /32 caractères/,
    );
  });

  it('tire des secrets aléatoires en développement, avec un avertissement', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'development' });
    expect(c.jwtAccessSecret.length).toBeGreaterThanOrEqual(32);
    expect(c.warnings.join(' ')).toMatch(/JWT_ACCESS_SECRET/);
  });

  it('lit les booléens et les listes', () => {
    const c = loadConfig({ ...base, TRUST_PROXY: 'true', PHOTO_AUTO_APPROVE: '1', CORS_ORIGINS: 'https://a.cm, https://b.cm' });
    expect(c.trustProxy).toBe(true);
    expect(c.photoAutoApprove).toBe(true);
    expect(c.corsOrigins).toEqual(['https://a.cm', 'https://b.cm']);
    expect(c.smtp).toBeNull();
  });

  it('refuse une valeur invalide', () => {
    expect(() => loadConfig({ ...base, API_PORT: 'abc' })).toThrow(/API_PORT/);
    expect(() => loadConfig({ ...base, ADMIN_TOKEN: 'court' })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});

describe('serveur', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp({ suite: 'app' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('GET /v1/health répond ok', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponseSchema.parse(res.json());
    expect(body).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('une route inconnue rend common.not_found', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'common.not_found', params: {} } });
  });

  it('un JSON illisible rend common.bad_request', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      headers: { 'content-type': 'application/json' },
      payload: '{pas du json',
    });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('common.bad_request');
  });

  it('une entrée invalide rend common.validation avec les champs en cause', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { device: { installId: 'x' } } });
    expect(res.statusCode).toBe(400);
    const body = ApiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('common.validation');
    expect(JSON.stringify(body.error.params)).toContain('device.installId');
  });

  it('pose les en-têtes de sécurité', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
  });

  it('une route protégée sans jeton rend auth.required', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'auth.required', params: {} } });
  });

  it('un jeton illisible rend auth.token_invalid', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer abc.def.ghi' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('auth.token_invalid');
  });
});

describe('limitation de débit', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp({ suite: 'ratelimit', env: { RATE_LIMIT_AUTH_PER_MIN: '5' } });
  });
  afterAll(async () => {
    await t.close();
  });

  it('5 essais de connexion par minute et par adresse IP, puis 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { login: `inconnu${i}`, password: 'x', device: { installId: 'install-rate', platform: 'ios' } },
      });
      codes.push(res.statusCode);
      if (res.statusCode === 429) {
        expect(res.json().error.code).toBe('common.rate_limited');
        expect(res.json().error.params.retryAfterSeconds).toBeGreaterThan(0);
      }
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });
});
