import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../../test/helpers.js';
import { formatShareCode, normalizeShareCode } from './routes.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp({ suite: 'share', env: { APP_INSTALL_URL: 'https://expo.dev/@kwatt/kwatt' } });
});
afterAll(async () => {
  await t.close();
});

describe('codes de partage', () => {
  it('se normalisent et s\'affichent « ABC-DEF »', () => {
    expect(normalizeShareCode(' m4t-k9q ')).toBe('M4TK9Q');
    expect(formatShareCode('M4TK9Q')).toBe('M4T-K9Q');
  });
});

describe('pages web /s/:code et /l/:code', () => {
  it('salon : ouvre kwatt://salon/CODE et explique l\'installation', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/s/m4t-k9q', headers: { 'accept-language': 'fr-CM,fr;q=0.9' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('href="kwatt://salon/M4TK9Q"');
    expect(res.body).toContain('M4T-K9Q');
    expect(res.body).toContain('Ouvrir dans Kwatt');
    expect(res.body).toContain('href="https://expo.dev/@kwatt/kwatt"');
    expect(res.body).toContain('<html lang="fr">');
    // Couleurs Kwatt (thème Nuit), aucun script.
    expect(res.body).toContain('#0F1230');
    expect(res.body).not.toContain('<script');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
  });

  it('ligue : ouvre kwatt://ligue/CODE', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/l/LGK2345' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('href="kwatt://ligue/LGK2345"');
  });

  it('dans la langue du navigateur, ou celle demandée', async () => {
    const en = await t.app.inject({ method: 'GET', url: '/s/ABCDEF', headers: { 'accept-language': 'en-GB,en;q=0.8' } });
    expect(en.body).toContain('<html lang="en">');
    expect(en.body).toContain('Open in Kwatt');
    const forced = await t.app.inject({ method: 'GET', url: '/s/ABCDEF?lang=fr', headers: { 'accept-language': 'en' } });
    expect(forced.body).toContain('<html lang="fr">');
  });

  it('un code impossible (0, O, 1, I, longueur) donne une page « lien invalide » en 404', async () => {
    for (const code of ['ABC0EF', 'ABCDE', 'ABCDEFG', '<script>']) {
      const res = await t.app.inject({ method: 'GET', url: `/s/${encodeURIComponent(code)}` });
      expect(res.statusCode, code).toBe(404);
      expect(res.body).not.toContain('kwatt://');
      expect(res.body).not.toContain('<script>');
    }
  });
});
