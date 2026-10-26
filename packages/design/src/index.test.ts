import { describe, expect, it } from 'vitest';
import { avatarSkins, contrastRatio, night, pleinSoleil, rarity, themes, type Theme } from './index.js';

/** Paires texte/fond qui doivent tenir 4,5:1 (consigne d'accessibilité, planche Audit). */
const textPairs: Array<[keyof Theme, keyof Theme]> = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surfaceStrong'],
  ['text', 'tabBar'],
  ['textMuted', 'bg'],
  ['textMuted', 'surface'],
  ['textMuted', 'tabBar'],
  ['actionText', 'bg'],
  ['onAction', 'action'],
  ['alert', 'bg'],
  ['gain', 'bg'],
  ['onInverse', 'inverse'],
];

describe('@kwatt/design · contrastes', () => {
  it('calcule le rapport WCAG (noir sur blanc = 21)', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('refuse une couleur mal formée', () => {
    expect(() => contrastRatio('rgba(0,0,0,1)', '#FFFFFF')).toThrow();
  });

  for (const [name, theme] of Object.entries(themes)) {
    for (const [fg, bg] of textPairs) {
      it(`${name} : ${String(fg)} sur ${String(bg)} ≥ 4,5:1`, () => {
        const ratio = contrastRatio(theme[fg] as string, theme[bg] as string);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("l'or de la nuit sur le fond tient 10:1 (planche Audit)", () => {
    expect(contrastRatio(night.action, night.bg)).toBeGreaterThan(10);
  });
});

describe('@kwatt/design · compléments', () => {
  it('les deux thèmes ont exactement les mêmes jetons', () => {
    expect(Object.keys(pleinSoleil).sort()).toEqual(Object.keys(night).sort());
  });

  it('cinq teints pour l’avatar et quatre raretés', () => {
    expect(avatarSkins).toHaveLength(5);
    expect(Object.keys(rarity)).toEqual(['commune', 'rare', 'epique', 'legendaire']);
  });
});

describe('@kwatt/design · aplats doux (absents des planches Plein soleil)', () => {
  it.each([['Nuit', night], ['Plein soleil', pleinSoleil]] as const)('%s : textes des aplats gains et pertes à 4,5:1 au moins', (_, theme) => {
    expect(contrastRatio(theme.gainSoftText, theme.gainSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.lossSoftText, theme.lossSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.text, theme.gainSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.text, theme.lossSoft)).toBeGreaterThanOrEqual(4.5);
  });

  it('raretés : lisibles sur le fond Nuit (en Plein soleil, ShopParts écrit le nom dans le texte du thème)', () => {
    for (const c of Object.values(rarity)) expect(contrastRatio(c, night.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

