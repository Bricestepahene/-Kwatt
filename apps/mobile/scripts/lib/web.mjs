/**
 * Outils communs des vérifications sur l'export web (captures, parcours) :
 * export, petit serveur de fichiers, table des routes, état de l'appareil injecté.
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const distDir = path.join(root, 'dist');
/** Port réservé à l'équipe fondation appli. */
export const PORT = Number(process.env.SCREENSHOTS_PORT ?? 8102);
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const PHONE_VIEWPORT = { width: 390, height: 844 };

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';

/** Valeurs d'exemple des segments dynamiques (mêmes que EXAMPLE_PARAMS de routes.ts). */
export const EXAMPLE_PARAMS = { code: 'M4TK9Q', id: 'demo', matchId: 'demo', userId: 'demo', jeu: 'dames' };

/** Routes lues dans src/navigation/routes.ts (source unique) : clé, écrans, motif, accès. */
export function readRoutes() {
  const source = readFileSync(path.join(root, 'src/navigation/routes.ts'), 'utf8');
  const routes = [];
  const block = /\{\s*key: '([A-Za-z]+)', screens: \[([^\]]*)\][\s\S]*?pattern: '([^']+)', access: '([a-zA-Z]+)'/g;
  for (const match of source.matchAll(block)) {
    const screens = [...match[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    routes.push({ key: match[1], screens, pattern: match[3], access: match[4] });
  }
  if (routes.length < 50) throw new Error(`Table des routes illisible (${routes.length} routes trouvées)`);
  return routes;
}

export function buildPath(pattern) {
  return pattern.replace(/\[([^\]]+)\]/g, (_, name) => encodeURIComponent(EXAMPLE_PARAMS[name] ?? 'demo'));
}

/** Exporte l'appli pour le web, l'API pointée sur le serveur local (aucun appel extérieur). */
export function exportWeb() {
  console.log('Export web (expo export --platform web)…');
  rmSync(distDir, { recursive: true, force: true });
  const result = spawnSync('npx', ['expo', 'export', '--platform', 'web'], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      CI: '1',
      EXPO_PUBLIC_SHOW_KIT: '1',
      EXPO_PUBLIC_API_URL: ORIGIN,
      EXPO_PUBLIC_WS_URL: `${ORIGIN.replace(/^http/, 'ws')}/v1/ws`,
    },
  });
  if (result.status !== 0) throw new Error('expo export a échoué');
}

export function ensureExport(skipExport) {
  if (!skipExport || !existsSync(path.join(distDir, 'index.html'))) exportWeb();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
};

/** Sert dist/ (repli sur index.html : appli d'une seule page) ; /v1/* répond « serveur indisponible ». */
export function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', ORIGIN);
    if (url.pathname.startsWith('/v1/')) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'network.server', params: {} } }));
      return;
    }
    let file = path.join(distDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const YEAR = 365 * 24 * 3600 * 1000;

/** Session gardée sur l'appareil (format de src/session/session.ts). */
export function sessionFor(kind) {
  if (kind === 'none') return null;
  const user =
    kind === 'guest'
      ? { id: 'guest', kind: 'guest', pseudo: null, ageBand: null, emailVerified: false }
      : { id: 'demo', kind: 'member', pseudo: 'brice_237', ageBand: kind === 'teen' ? 'teen' : 'adult', emailVerified: true };
  return { tokens: { accessToken: 'demo', refreshToken: 'demo', accessExpiresAt: Date.now() + YEAR }, user };
}

/**
 * Nouveau contexte de navigateur avec préférences et session déjà sur « l'appareil ».
 * @param browser  navigateur Playwright
 * @param options  { prefs, session, viewport, lang }
 */
export async function newDeviceContext(browser, { prefs = {}, session = null, viewport = PHONE_VIEWPORT, lang = 'fr' } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: lang === 'en' ? 'en-GB' : 'fr-FR' });
  await context.addInitScript(
    ({ prefs: p, session: s }) => {
      // Une seule fois par onglet : les rechargements gardent ce que l'appli a écrit.
      if (window.sessionStorage.getItem('kwatt.seeded')) return;
      window.sessionStorage.setItem('kwatt.seeded', '1');
      window.localStorage.setItem('kwatt.preferences.v1', JSON.stringify(p));
      if (s) window.localStorage.setItem('kwatt.session.v1', JSON.stringify(s));
      else window.localStorage.removeItem('kwatt.session.v1');
    },
    { prefs, session },
  );
  // Test de joignabilité d'Internet (NetInfo) : on répond « en ligne ».
  await context.route(/generate_204/, (r) => r.fulfill({ status: 204, body: '' }));
  return context;
}
