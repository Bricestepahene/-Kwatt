#!/usr/bin/env node
/**
 * Vérification visuelle : exporte l'appli pour le web, la sert en local et capture
 * chaque route (src/navigation/routes.ts) en 390 × 844, en français et en anglais,
 * en thème Nuit et Plein soleil, avec Playwright (Chromium déjà installé).
 *
 *   node scripts/screenshots.mjs                    # export + toutes les captures
 *   node scripts/screenshots.mjs --no-export        # réutilise dist/
 *   node scripts/screenshots.mjs --only kit,salon --langs fr --themes night
 *
 * Sortie : screenshots/<langue>-<thème>/<ordre>-<clé>.png (dossier non versionné).
 * Le script échoue si une page lève une erreur JavaScript.
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const outDir = path.join(root, 'screenshots');
const PORT = Number(process.env.SCREENSHOTS_PORT ?? 8102);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';

// --- Arguments --------------------------------------------------------------------
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const only = option('only')?.split(',').filter(Boolean);
const langs = (option('langs') ?? 'fr,en').split(',');
const themes = (option('themes') ?? 'night,sun').split(',');
const skipExport = args.includes('--no-export');

// --- Routes (lues dans la table, source unique) -------------------------------------
/** Valeurs d'exemple des segments dynamiques (mêmes que EXAMPLE_PARAMS de routes.ts). */
const EXAMPLE_PARAMS = { code: 'M4TK9Q', id: 'demo', matchId: 'demo', userId: 'demo', jeu: 'dames' };

function readRoutes() {
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

function buildPath(pattern) {
  return pattern.replace(/\[([^\]]+)\]/g, (_, name) => encodeURIComponent(EXAMPLE_PARAMS[name] ?? 'demo'));
}

function order(route) {
  const first = route.screens[0];
  const m = first ? /^(\d+)([a-z]?)$/.exec(first) : null;
  return m ? `${m[1]}${m[2] || ''}` : 'zz';
}

// --- Export web -----------------------------------------------------------------------
function exportWeb() {
  console.log('Export web (expo export --platform web)…');
  rmSync(distDir, { recursive: true, force: true });
  const result = spawnSync('npx', ['expo', 'export', '--platform', 'web'], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      CI: '1',
      EXPO_PUBLIC_SHOW_KIT: '1',
      // L'API pointe sur ce serveur de fichiers : aucune requête ne part vers un vrai serveur.
      EXPO_PUBLIC_API_URL: ORIGIN,
      EXPO_PUBLIC_WS_URL: `${ORIGIN.replace(/^http/, 'ws')}/v1/ws`,
    },
  });
  if (result.status !== 0) throw new Error('expo export a échoué');
}

// --- Serveur de fichiers (repli sur index.html : appli d'une seule page) -------------------
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

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', ORIGIN);
    if (url.pathname.startsWith('/v1/')) {
      // Pas de serveur Kwatt pendant les captures : réponse d'erreur propre.
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'network.server', params: {} } }));
      return;
    }
    let file = path.join(distDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

// --- État de l'appareil injecté (préférences, session) ---------------------------------
const YEAR = 365 * 24 * 3600 * 1000;
function deviceState(route, lang, theme) {
  const prefs = { language: lang, theme: theme === 'sun' ? 'sun' : 'night' };
  // Écrans d'entrée : sans session (un profil connecté en serait renvoyé).
  const needsSession = route.access === 'guest' || route.access === 'member' || route.access === 'adult';
  const session = needsSession
    ? {
        tokens: { accessToken: 'demo', refreshToken: 'demo', accessExpiresAt: Date.now() + YEAR },
        user: { id: 'demo', kind: 'member', pseudo: 'brice_237', ageBand: 'adult', emailVerified: true },
      }
    : null;
  return { prefs, session };
}

// --- Captures ---------------------------------------------------------------------------------
async function main() {
  const { chromium } = await import('playwright-core');
  if (!skipExport || !existsSync(path.join(distDir, 'index.html'))) exportWeb();
  const routes = readRoutes().filter((r) => !only || only.includes(r.key));
  const server = await serve();
  const browser = await chromium.launch();
  const failures = [];
  let count = 0;

  try {
    for (const lang of langs) {
      for (const theme of themes) {
        const dir = path.join(outDir, `${lang}-${theme}`);
        mkdirSync(dir, { recursive: true });
        for (const route of routes) {
          // Le catalogue du kit est long : on le capture en entier.
          const viewport = route.key === 'kit' ? { width: VIEWPORT.width, height: 4600 } : VIEWPORT;
          const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: lang === 'en' ? 'en-GB' : 'fr-FR' });
          const state = deviceState(route, lang, theme);
          await context.addInitScript(({ prefs, session }) => {
            window.localStorage.setItem('kwatt.preferences.v1', JSON.stringify(prefs));
            if (session) window.localStorage.setItem('kwatt.session.v1', JSON.stringify(session));
            else window.localStorage.removeItem('kwatt.session.v1');
          }, state);
          // Test de joignabilité d'Internet (NetInfo) : on répond « en ligne ».
          await context.route(/generate_204/, (r) => r.fulfill({ status: 204, body: '' }));
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const url = `${ORIGIN}${buildPath(route.pattern)}`;
          try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(400);
            const file = path.join(dir, `${order(route)}-${route.key}.png`);
            await page.screenshot({ path: file });
            count += 1;
          } catch (error) {
            errors.push(String(error));
          }
          if (errors.length > 0) failures.push({ route: route.key, lang, theme, errors });
          await context.close();
        }
        console.log(`  ${lang} · ${theme} : ${routes.length} routes`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`${count} captures dans ${path.relative(process.cwd(), outDir) || outDir}`);
  if (failures.length > 0) {
    console.error(`Erreurs sur ${failures.length} captures :`);
    for (const f of failures) console.error(`- ${f.route} (${f.lang}, ${f.theme}) : ${f.errors.join(' | ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
