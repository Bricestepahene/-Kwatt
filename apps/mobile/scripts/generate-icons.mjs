#!/usr/bin/env node
/**
 * Génère l'icône, l'icône adaptative Android, l'écran de démarrage, le favicon
 * et l'icône de notification à partir du logo de la planche « Réf · Identité »
 * (assets/brand/logo.svg). Les tissus sont dessinés en SVG, jamais en image source.
 *
 * Rendu avec Chromium (playwright-core). Sur la machine de développement :
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @kwatt/mobile assets:icons
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'assets', 'images');

// Couleurs de @kwatt/design (brand) : le script est en JS pur et ne lit pas le paquet TS.
const NUIT = '#0F1230';
const NDOP = '#1D2B6E';
const NDOP_MOTIF = 'rgba(244,238,223,.13)';

const logoSvg = await readFile(path.join(root, 'assets', 'brand', 'logo.svg'), 'utf8');
/** Contenu du logo sans la balise <svg> englobante, pour l'insérer dans un autre dessin. */
const logoInner = logoSvg
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

/** Motif ndop (dents de loup), même géométrie que la planche : tuile de 24 px. */
function ndopPattern(id, scale) {
  const s = 24 * scale;
  const h = s / 2;
  return `<pattern id="${id}" width="${s}" height="${s}" patternUnits="userSpaceOnUse">
    <rect width="${s}" height="${s}" fill="${NDOP}"/>
    <path d="M0 0 L${s} 0 L${h} ${h} Z M0 ${s} L0 ${h} L${h} ${s} Z M${s} ${s} L${h} ${s} L${s} ${h} Z" fill="${NDOP_MOTIF}"/>
  </pattern>`;
}

/** Logo centré, de diamètre `d` px, dans un carré de `size` px. */
function placedLogo(size, d) {
  const k = d / 112; // le disque du logo fait 112 unités (rayon 56)
  const offset = size / 2 - 60 * k;
  return `<g transform="translate(${offset} ${offset}) scale(${k})">${logoInner}</g>`;
}

/** Silhouette blanche du logo (icônes monochromes Android et notifications). */
function silhouette(size, d) {
  const k = d / 112;
  const offset = size / 2 - 60 * k;
  return `<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
      <circle cx="60" cy="60" r="56" fill="#fff"/>
      <circle cx="60" cy="60" r="36" fill="#000"/>
      <circle cx="60" cy="60" r="31" fill="#fff"/>
      <circle cx="60" cy="60" r="24" fill="none" stroke="#000" stroke-width="4"/>
      <path d="M60 44 L76 60 L60 76 L44 60 Z" fill="#000"/>
      <path d="M60 53 L67 60 L60 67 L53 60 Z" fill="#fff"/>
    </mask></defs>
    <g transform="translate(${offset} ${offset}) scale(${k})"><rect width="120" height="120" fill="#fff" mask="url(#m)"/></g>`;
}

const svg = (size, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

const targets = [
  {
    // iOS et Expo Go : carré plein (pas de transparence), tissu ndop et logo.
    file: 'icon.png',
    size: 1024,
    body: (s) => `<defs>${ndopPattern('p', s / 256)}</defs><rect width="${s}" height="${s}" fill="url(#p)"/>${placedLogo(s, s * 0.74)}`,
  },
  {
    // Android : premier plan dans la zone sûre (66 % du carré).
    file: 'adaptive-icon.png',
    size: 1024,
    transparent: true,
    body: (s) => placedLogo(s, s * 0.6),
  },
  {
    file: 'adaptive-icon-background.png',
    size: 1024,
    body: (s) => `<defs>${ndopPattern('p', s / 256)}</defs><rect width="${s}" height="${s}" fill="url(#p)"/>`,
  },
  {
    file: 'adaptive-icon-monochrome.png',
    size: 1024,
    transparent: true,
    body: (s) => silhouette(s, s * 0.6),
  },
  {
    // Écran de démarrage : logo seul sur fond nuit (couleur posée par expo-splash-screen).
    file: 'splash-icon.png',
    size: 1024,
    transparent: true,
    body: (s) => placedLogo(s, s * 0.96),
  },
  {
    file: 'favicon.png',
    size: 48,
    transparent: true,
    body: (s) => placedLogo(s, s * 0.96),
  },
  {
    file: 'notification-icon.png',
    size: 96,
    transparent: true,
    body: (s) => silhouette(s, s * 0.9),
  },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const t of targets) {
    const markup = svg(t.size, t.body(t.size));
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:${t.transparent ? 'transparent' : NUIT}">${markup}</body></html>`,
    );
    const png = await page.locator('svg').screenshot({ omitBackground: Boolean(t.transparent) });
    await writeFile(path.join(out, t.file), png);
    console.log(`✓ ${t.file} (${t.size}×${t.size})`);
  }
} finally {
  await browser.close();
}
