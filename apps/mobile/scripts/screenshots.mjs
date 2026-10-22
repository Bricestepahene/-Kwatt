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
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildPath, ensureExport, newDeviceContext, ORIGIN, PHONE_VIEWPORT, readRoutes, root, serve, sessionFor } from './lib/web.mjs';

const outDir = path.join(root, 'screenshots');

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const only = option('only')?.split(',').filter(Boolean);
const langs = (option('langs') ?? 'fr,en').split(',');
const themes = (option('themes') ?? 'night,sun').split(',');

/** « 16b » → nom de fichier trié dans l'ordre du Sommaire ; routes techniques à la fin. */
function order(route) {
  return route.screens[0] ?? 'zz';
}

/** Écrans d'entrée : sans session (un profil connecté en serait renvoyé) ; sinon profil adulte. */
function sessionKind(route) {
  return route.access === 'guest' || route.access === 'member' || route.access === 'adult' ? 'adult' : 'none';
}

async function main() {
  const { chromium } = await import('playwright-core');
  ensureExport(args.includes('--no-export'));
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
          const viewport = route.key === 'kit' ? { width: PHONE_VIEWPORT.width, height: 4600 } : PHONE_VIEWPORT;
          const context = await newDeviceContext(browser, {
            prefs: { language: lang, theme: theme === 'sun' ? 'sun' : 'night' },
            session: sessionFor(sessionKind(route)),
            viewport,
            lang,
          });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          try {
            await page.goto(`${ORIGIN}${buildPath(route.pattern)}`, { waitUntil: 'networkidle', timeout: 30_000 });
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(dir, `${order(route)}-${route.key}.png`) });
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
