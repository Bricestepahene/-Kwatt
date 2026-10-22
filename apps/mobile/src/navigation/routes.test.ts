import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flattenCatalog, type Catalog } from '../i18n/catalogTools';
import { buildPath, patternFromSegments, routeForPattern, ROUTES, ROUTES_BY_KEY, type RouteSpec } from './routes';
import { renderRoutesMarkdown, screenOrder } from './routesDoc';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(mobileRoot, '../..');
const appDir = path.join(mobileRoot, 'app');

/** Fichiers spéciaux d'expo-router (pas des écrans). */
const SPECIAL = /(^|\/)(_layout|\+not-found|\+native-intent|\+html)\.tsx?$/;

function listRouteFiles(dir: string, base = 'app'): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = `${base}/${name}`;
    if (statSync(full).isDirectory()) out.push(...listRouteFiles(full, rel));
    else if (/\.tsx?$/.test(name) && !SPECIAL.test(rel)) out.push(rel);
  }
  return out;
}

/** Motif d'URL d'un fichier de route, comme expo-router le calcule. */
function patternOfFile(file: string): string {
  const segments = file
    .replace(/^app\//, '')
    .replace(/\.tsx?$/, '')
    .split('/');
  return patternFromSegments(segments);
}

/** Tous les écrans du Sommaire (SPEC §1) : 01 à 43, plus les écrans « b » et « c ». */
const SOMMAIRE_SCREENS = [
  ...Array.from({ length: 43 }, (_, i) => String(i + 1).padStart(2, '0')),
  '16b', '19b', '20b', '21b', '21c', '28b', '34b',
];

function catalog(language: string, ns: string): Record<string, string> {
  const file = path.join(mobileRoot, 'src/i18n/locales', language, `${ns}.json`);
  return flattenCatalog(JSON.parse(readFileSync(file, 'utf8')) as Catalog);
}

describe('table des routes', () => {
  it('a des clés et des motifs uniques', () => {
    const keys = ROUTES.map((r) => r.key);
    const patterns = ROUTES.map((r) => r.pattern);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('couvre tous les écrans du Sommaire', () => {
    const covered = new Set<string>(ROUTES.flatMap((r) => r.screens));
    expect(SOMMAIRE_SCREENS.filter((s) => !covered.has(s))).toEqual([]);
    expect([...covered].filter((s) => !SOMMAIRE_SCREENS.includes(s))).toEqual([]);
  });

  it('cite des planches qui existent dans docs/maquette', () => {
    for (const route of ROUTES) {
      for (const planche of route.planches) {
        expect(existsSync(path.join(repoRoot, 'docs/maquette', `${planche}.dc.html`)), `${route.key} → ${planche}`).toBe(true);
      }
    }
  });

  it('a un fichier de route pour chaque entrée, au bon motif', () => {
    for (const route of ROUTES) {
      expect(existsSync(path.join(mobileRoot, route.file)), route.file).toBe(true);
      expect(patternOfFile(route.file), route.file).toBe(route.pattern);
    }
  });

  it('déclare chaque fichier de route du dossier app/', () => {
    const declared = new Set<string>(ROUTES.map((r) => r.file));
    expect(listRouteFiles(appDir).filter((f) => !declared.has(f))).toEqual([]);
  });

  it('ne pointe que vers des routes connues', () => {
    for (const route of ROUTES as readonly RouteSpec[]) {
      for (const link of route.links ?? []) {
        expect(ROUTES_BY_KEY, `${route.key} → ${link}`).toHaveProperty([link]);
      }
    }
  });

  it('a un titre et une phrase d’accroche en fr et en en', () => {
    for (const language of ['fr', 'en']) {
      const screens = catalog(language, 'screens');
      for (const route of ROUTES) {
        expect(screens[`${route.key}.title`], `${language} · ${route.key}.title`).toBeTruthy();
        expect(screens[`${route.key}.lead`], `${language} · ${route.key}.lead`).toBeTruthy();
      }
    }
  });

  it('retrouve la route depuis les segments d’expo-router', () => {
    expect(patternFromSegments(['(tabs)'])).toBe('/');
    expect(patternFromSegments(['(tabs)', 'jouer', 'dames'])).toBe('/jouer/dames');
    expect(patternFromSegments(['salon', '[code]'])).toBe('/salon/[code]');
    expect(routeForPattern('/salon/[code]')?.key).toBe('salon');
    expect(routeForPattern('/ligue/[id]/match/[matchId]')?.key).toBe('matchDuJour');
    expect(routeForPattern('/nulle-part')).toBeUndefined();
  });

  it('construit les URL avec les paramètres (et des exemples à défaut)', () => {
    expect(buildPath('/salon/[code]', { code: 'ABCDEF' })).toBe('/salon/ABCDEF');
    expect(buildPath('/ligue/[id]/match/[matchId]')).toBe('/ligue/demo/match/demo');
    expect(buildPath('/regles/[jeu]', { jeu: 'ludo' })).toBe('/regles/ludo');
  });

  it('range les écrans dans l’ordre du Sommaire', () => {
    expect(screenOrder('16')).toBeLessThan(screenOrder('16b'));
    expect(screenOrder('16b')).toBeLessThan(screenOrder('17'));
    expect(screenOrder('21b')).toBeLessThan(screenOrder('21c'));
  });

  it('ROUTES.md est à jour', () => {
    const file = path.join(mobileRoot, 'ROUTES.md');
    const expected = renderRoutesMarkdown();
    if (process.env.UPDATE_ROUTES_DOC === '1') writeFileSync(file, expected);
    expect(existsSync(file), 'ROUTES.md manquant : pnpm --filter @kwatt/mobile routes:doc').toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(expected);
  });
});
