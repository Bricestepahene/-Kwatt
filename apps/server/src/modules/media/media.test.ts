import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../../test/helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'media' });
});
afterAll(async () => {
  await t.close();
});

describe('médias', () => {
  it('un fichier enregistré est servi sous /media/ avec son URL publique', async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
    const url = await t.app.media.save('avatars/abc/photo.webp', bytes);
    expect(url).toBe('http://kwatt.test/media/avatars/abc/photo.webp');
    const res = await t.app.inject({ method: 'GET', url: '/media/avatars/abc/photo.webp' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(new Uint8Array(res.rawPayload)).toEqual(bytes);
    expect(res.headers['cache-control']).toContain('max-age=604800');
  });

  it('un fichier absent rend common.not_found', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/media/rien/ici.webp' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'common.not_found', params: {} } });
  });

  it('refuse de sortir du dossier des médias', async () => {
    expect(() => t.app.media.pathOf('../secret.txt')).toThrow(/invalide/);
    expect(() => t.app.media.pathOf('/etc/passwd')).toThrow(/invalide/);
    expect(() => t.app.media.pathOf('a/../../b')).toThrow(/invalide/);
    const res = await t.app.inject({ method: 'GET', url: '/media/..%2f..%2fpackage.json' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toContain('"name"');
  });

  it('un fichier supprimé n\'est plus servi', async () => {
    await t.app.media.save('tmp/x.txt', new TextEncoder().encode('x'));
    await t.app.media.remove('tmp/x.txt');
    expect((await t.app.inject({ method: 'GET', url: '/media/tmp/x.txt' })).statusCode).toBe(404);
  });
});
