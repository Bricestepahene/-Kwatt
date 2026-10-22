import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flattenCatalog, interpolationVariables, pluralBase, type Catalog } from './catalogTools';
import { LANGUAGES } from './languages';
import { NAMESPACES, resources } from './resources';
import { createI18n } from './setup';

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'locales');

function listLanguages(): string[] {
  return readdirSync(localesDir)
    .filter((name) => statSync(path.join(localesDir, name)).isDirectory())
    .sort();
}

function listNamespaces(language: string): string[] {
  return readdirSync(path.join(localesDir, language))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

function readCatalog(language: string, ns: string): Catalog {
  return JSON.parse(readFileSync(path.join(localesDir, language, `${ns}.json`), 'utf8')) as Catalog;
}

/** Clés de base (formes plurielles regroupées) → variables d'interpolation de toutes les formes. */
function keyMap(catalog: Catalog): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const [key, value] of Object.entries(flattenCatalog(catalog))) {
    const base = pluralBase(key);
    const vars = map.get(base) ?? new Set<string>();
    for (const v of interpolationVariables(value)) vars.add(v);
    map.set(base, vars);
  }
  return new Map([...map].map(([k, v]) => [k, [...v].sort()]));
}

describe('catalogues de traduction · parité fr / en', () => {
  it('les dossiers de langues sont exactement fr et en', () => {
    expect(listLanguages()).toEqual([...LANGUAGES].sort());
  });

  it('les deux langues ont les mêmes fichiers (espaces de noms)', () => {
    expect(listNamespaces('en')).toEqual(listNamespaces('fr'));
  });

  for (const ns of listNamespaces('fr')) {
    describe(`${ns}.json`, () => {
      const fr = readCatalog('fr', ns);
      const en = readCatalog('en', ns);
      const frKeys = keyMap(fr);
      const enKeys = keyMap(en);

      it('a exactement les mêmes clés en fr et en en', () => {
        const onlyFr = [...frKeys.keys()].filter((k) => !enKeys.has(k));
        const onlyEn = [...enKeys.keys()].filter((k) => !frKeys.has(k));
        expect({ onlyFr, onlyEn }).toEqual({ onlyFr: [], onlyEn: [] });
      });

      it('utilise les mêmes variables {{…}} dans les deux langues', () => {
        const mismatches = [...frKeys].filter(([k, vars]) => enKeys.has(k) && enKeys.get(k)!.join() !== vars.join());
        expect(mismatches).toEqual([]);
      });

      it('n’a aucune phrase vide', () => {
        for (const catalog of [fr, en]) {
          const empty = Object.entries(flattenCatalog(catalog)).filter(([, v]) => v.trim() === '');
          expect(empty).toEqual([]);
        }
      });

      it('chaque pluriel a ses formes _one et _other', () => {
        for (const catalog of [fr, en]) {
          const flat = flattenCatalog(catalog);
          const bases = new Set(Object.keys(flat).filter((k) => pluralBase(k) !== k).map(pluralBase));
          for (const base of bases) {
            expect(flat, `${ns}:${base}`).toHaveProperty([`${base}_one`]);
            expect(flat, `${ns}:${base}`).toHaveProperty([`${base}_other`]);
          }
        }
      });

      it('est déclaré dans resources.ts, avec le contenu du fichier', () => {
        expect(NAMESPACES).toContain(ns);
        const declared = resources as unknown as Record<string, Record<string, Catalog>>;
        expect(declared.fr?.[ns]).toEqual(fr);
        expect(declared.en?.[ns]).toEqual(en);
      });
    });
  }

  it('resources.ts ne déclare aucun espace de noms sans fichier', () => {
    expect([...NAMESPACES].sort()).toEqual(listNamespaces('fr'));
  });
});

describe('instance i18next', () => {
  it('accorde les cauris en français, y compris pour un million (forme « many »)', () => {
    const i18n = createI18n('fr');
    expect(i18n.t('common:cauris.amount', { count: 1, amount: '1' })).toBe('1 cauri');
    expect(i18n.t('common:cauris.amount', { count: 2450, amount: '2 450' })).toBe('2 450 cauris');
    expect(i18n.t('common:cauris.amount', { count: 1_000_000, amount: '1 000 000' })).toBe('1 000 000 cauris');
  });

  it('accorde les cauris en anglais', () => {
    const i18n = createI18n('en');
    expect(i18n.t('common:cauris.amount', { count: 1, amount: '1' })).toBe('1 cowry');
    expect(i18n.t('common:cauris.amount', { count: 2450, amount: '2,450' })).toBe('2,450 cowries');
  });

  it('pose une espace insécable avant la ponctuation haute en français seulement', () => {
    expect(createI18n('fr').t('common:reaction.tu_dors')).toBe('Tu dors ?');
    expect(createI18n('en').t('common:reaction.tu_dors')).toBe('Asleep?');
  });

  it('change de langue instantanément', async () => {
    const i18n = createI18n('fr');
    expect(i18n.t('common:tabs.home')).toBe('Accueil');
    await i18n.changeLanguage('en');
    expect(i18n.t('common:tabs.home')).toBe('Home');
  });

  it('garde le vocabulaire anglais fixé par la SPEC (§4)', () => {
    const en = createI18n('en');
    expect(en.t('common:cauris.label')).toBe('cowries');
    expect(en.t('common:rank.debrouillard')).toBe('Hustler');
    expect(en.t('common:rank.ancien')).toBe('Kwatt Elder');
    expect(en.t('preferences:display.sun')).toBe('Full sun');
    expect(en.t('screens:quartiers.title')).toBe('Neighbourhood war');
    expect(en.t('common:reaction.ekie')).toBe('Ékié !');
  });
});
