#!/usr/bin/env node
/**
 * Parcours de fumée sur l'export web : garde de session, liens, onglets, « Jouer »,
 * changement de langue et de thème instantanés, page introuvable. Rapide (≈ 30 s).
 *
 *   node scripts/smoke-web.mjs              # export + parcours
 *   node scripts/smoke-web.mjs --no-export  # réutilise dist/
 */
import { ensureExport, newDeviceContext, ORIGIN, serve, sessionFor } from './lib/web.mjs';

const results = [];

async function check(browser, name, setup, run) {
  const context = await newDeviceContext(browser, setup);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await run(page);
    if (errors.length > 0) throw new Error(`erreur JavaScript : ${errors.join(' | ')}`);
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message.split('\n')[0] : String(error) });
  } finally {
    await context.close();
  }
}

/** Attend que l'URL (chemin + requête) soit exactement `expected`. */
async function expectPath(page, expected) {
  await page.waitForFunction((want) => window.location.pathname + window.location.search === want, expected, { timeout: 15_000 }).catch(() => {
    throw new Error(`attendu ${expected}, obtenu ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
  });
}

async function main() {
  const { chromium } = await import('playwright-core');
  ensureExport(process.argv.includes('--no-export'));
  const server = await serve();
  const browser = await chromium.launch();
  const fr = { language: 'fr', theme: 'night' };

  try {
    await check(browser, 'sans session : l’accueil renvoie à Bienvenue', { prefs: fr }, async (page) => {
      await page.goto(`${ORIGIN}/`);
      await expectPath(page, '/bienvenue');
      await page.getByRole('heading', { name: 'Bienvenue' }).waitFor();
    });

    await check(browser, 'sans session : un lien de salon passe par « Rejoindre », code normalisé', { prefs: fr }, async (page) => {
      await page.goto(`${ORIGIN}/salon/m4t-k9q`);
      await expectPath(page, '/rejoindre?code=M4TK9Q');
    });

    await check(browser, 'lien de partage /s/CODE → salon (puis Rejoindre sans session)', { prefs: fr }, async (page) => {
      await page.goto(`${ORIGIN}/s/m4tk9q`);
      await expectPath(page, '/rejoindre?code=M4TK9Q');
    });

    await check(browser, 'invité : un écran de profil renvoie à Bienvenue avec next', { prefs: fr, session: sessionFor('guest') }, async (page) => {
      await page.goto(`${ORIGIN}/amis`);
      await expectPath(page, '/bienvenue?next=%2Famis');
    });

    await check(browser, 'invité : peut ouvrir un salon', { prefs: fr, session: sessionFor('guest') }, async (page) => {
      await page.goto(`${ORIGIN}/salon/M4TK9Q`);
      await page.getByRole('heading', { name: 'Salon' }).waitFor();
      await expectPath(page, '/salon/M4TK9Q');
    });

    await check(browser, 'profil : les écrans d’entrée renvoient à l’accueil', { prefs: fr, session: sessionFor('adult') }, async (page) => {
      await page.goto(`${ORIGIN}/connexion`);
      await expectPath(page, '/');
      await page.getByRole('heading', { name: 'Accueil' }).waitFor();
    });

    await check(browser, 'moins de 18 ans : pas de défi avec mise', { prefs: fr, session: sessionFor('teen') }, async (page) => {
      await page.goto(`${ORIGIN}/defi/demo`);
      await expectPath(page, '/');
      await page.getByText('Réservé aux 18 ans et plus.').waitFor();
    });

    await check(browser, '« Jouer » rouvre le dernier espace (Ludo)', { prefs: { ...fr, lastSpace: 'ludo' }, session: sessionFor('adult') }, async (page) => {
      await page.goto(`${ORIGIN}/jouer`);
      await expectPath(page, '/jouer/ludo');
    });

    await check(browser, 'barre du bas : l’onglet Ligues', { prefs: fr, session: sessionFor('adult') }, async (page) => {
      await page.goto(`${ORIGIN}/`);
      await page.getByRole('tab', { name: 'Ligues' }).click();
      await expectPath(page, '/ligues');
      await page.getByRole('heading', { name: 'Ligues' }).waitFor();
    });

    await check(browser, 'langue : English tout de suite, et gardée au rechargement', { prefs: fr }, async (page) => {
      await page.goto(`${ORIGIN}/bienvenue`);
      await page.getByRole('heading', { name: 'Bienvenue' }).waitFor();
      await page.getByRole('tab', { name: 'English' }).click();
      await page.getByRole('heading', { name: 'Welcome' }).waitFor({ timeout: 5_000 });
      const lang = await page.evaluate(() => document.documentElement.lang);
      if (lang !== 'en') throw new Error(`<html lang> = ${lang}`);
      await page.reload();
      await page.getByRole('heading', { name: 'Welcome' }).waitFor();
    });

    await check(browser, 'thème : Plein soleil tout de suite', { prefs: fr, session: sessionFor('adult') }, async (page) => {
      await page.goto(`${ORIGIN}/parametres`);
      await page.getByRole('heading', { name: 'Paramètres' }).waitFor();
      await page.getByRole('tab', { name: 'Plein soleil' }).click();
      await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(251, 246, 234)', null, { timeout: 5_000 });
    });

    await check(browser, 'page introuvable', { prefs: fr, session: sessionFor('adult') }, async (page) => {
      await page.goto(`${ORIGIN}/nulle-part`);
      await page.getByRole('heading', { name: 'Page introuvable' }).first().waitFor();
    });

    await check(browser, 'catalogue du kit sans erreur', { prefs: fr }, async (page) => {
      await page.goto(`${ORIGIN}/kit`);
      await page.getByRole('heading', { name: 'Kit Kwatt' }).waitFor();
    });
  } finally {
    await browser.close();
    server.close();
  }

  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} parcours réussis`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
