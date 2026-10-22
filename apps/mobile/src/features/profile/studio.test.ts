import type { MyAvatar, ShopItem } from '@kwatt/protocol';
import { describe, expect, it } from 'vitest';
import { avatarProps, toAvatarSpec } from './looks';
import {
  featuredEdition,
  initialDraft,
  previewSpec,
  purchasePlan,
  saveRequest,
  selectedItems,
  shopButton,
  shopGrid,
  splitCatalog,
  studioAction,
  type StudioDraft,
} from './studio';

function item(code: string, kind: ShopItem['kind'], fields: Partial<ShopItem> = {}): ShopItem {
  return {
    code,
    kind,
    rarity: 'commune',
    price: null,
    edition: null,
    minRank: null,
    isDefault: false,
    render: {},
    owned: false,
    serial: null,
    locked: false,
    buyable: false,
    sortOrder: 0,
    ...fields,
  };
}

/** Catalogue de la planche Studio : prix des coiffes et tenues, pièces de base à toi. */
const CATALOG = splitCatalog([
  ...[0, 1, 2, 3, 4].map((tone) => item(`skin_${tone + 1}`, 'avatar_skin', { render: { tone }, owned: true, isDefault: true, sortOrder: 10 + tone })),
  item('hat_ndop', 'avatar_hat', { render: { fabric: 'ndop', shape: 'bonnet' }, owned: true, isDefault: true, sortOrder: 20 }),
  item('hat_kaba', 'avatar_hat', { render: { fabric: 'kaba', shape: 'foulard' }, price: 150, buyable: true, sortOrder: 21 }),
  item('hat_toghu', 'avatar_hat', { render: { fabric: 'toghu', shape: 'toque' }, price: 600, buyable: true, sortOrder: 22 }),
  item('outfit_obom', 'avatar_outfit', { render: { fabric: 'obom' }, owned: true, isDefault: true, sortOrder: 30 }),
  item('outfit_toghu', 'avatar_outfit', { render: { fabric: 'toghu' }, price: 900, buyable: true, sortOrder: 33 }),
  item('frame_toghu', 'frame', { render: { fabric: 'toghu' }, owned: true, isDefault: true, sortOrder: 41 }),
  item('frame_trone_du_fon', 'frame', { render: { fabric: 'toghu' }, rarity: 'legendaire', minRank: 'fon', locked: true, sortOrder: 49 }),
  item('preset_notable', 'avatar_preset', {
    render: { skin: 2, hat: { fabric: 'obom', shape: 'toque' }, outfit: 'ndop', background: 'toghu' },
    rarity: 'epique',
    price: 1500,
    buyable: true,
    sortOrder: 54,
  }),
  item('preset_debrouillard', 'avatar_preset', { render: { skin: 2, hat: null, outfit: 'ndop', background: 'obom' }, price: 80, owned: true }),
  item('preset_prince_wouri', 'avatar_preset', {
    render: { skin: 3, hat: null, outfit: 'toghu', background: 'kaba', event: 'ngondo_2026' },
    rarity: 'legendaire',
    price: 2400,
    buyable: true,
    edition: { total: 500, sold: 312 },
  }),
]);

const MINE_EMPTY: MyAvatar = {
  mode: 'avatar',
  selection: { kind: 'initial' },
  frame: null,
  photo: null,
  look: { avatar: { kind: 'initial' }, frame: null },
  ownLook: { avatar: { kind: 'initial' }, frame: null },
};

describe('Studio d\'avatar', () => {
  it('propose une composition de base quand rien n\'est choisi (teint du milieu, bonnet ndop, obom)', () => {
    const draft = initialDraft(MINE_EMPTY, CATALOG);
    expect(draft).toEqual({ mode: 'avatar', selection: { kind: 'composed', skin: 'skin_3', hat: 'hat_ndop', outfit: 'outfit_obom' }, frame: null });
    expect(previewSpec(draft.selection, CATALOG)).toEqual({
      kind: 'composed',
      skin: 2,
      hat: { fabric: 'ndop', shape: 'bonnet' },
      outfit: 'obom',
    });
  });

  it('« Enregistrer » quand tout est à toi, « Acheter · X cauris » sinon (planche : 600 + 900)', () => {
    const owned: StudioDraft = { mode: 'avatar', selection: { kind: 'composed', skin: 'skin_2', hat: 'hat_ndop', outfit: 'outfit_obom' }, frame: 'frame_toghu' };
    expect(studioAction(owned, CATALOG, 2450, false)).toEqual({ kind: 'save' });
    const trying: StudioDraft = { ...owned, selection: { kind: 'composed', skin: 'skin_2', hat: 'hat_toghu', outfit: 'outfit_toghu' } };
    expect(studioAction(trying, CATALOG, 2450, false)).toEqual({ kind: 'buy', total: 1500 });
    const plan = purchasePlan(selectedItems(trying, CATALOG), 1000);
    expect(plan.items.map((i) => i.code)).toEqual(['hat_toghu', 'outfit_toghu']);
    expect([plan.total, plan.missing]).toEqual([1500, 500]);
  });

  it('bloque un objet qui ne s\'achète pas (cadre du Fon, échelon trop bas)', () => {
    const draft: StudioDraft = { mode: 'avatar', selection: { kind: 'composed', skin: 'skin_2', hat: null, outfit: 'outfit_obom' }, frame: 'frame_trone_du_fon' };
    expect(studioAction(draft, CATALOG, 99999, false)).toMatchObject({ kind: 'blocked', item: { code: 'frame_trone_du_fon' } });
  });

  it('en mode photo : il faut une photo, et seul le cadre compte', () => {
    const draft: StudioDraft = { mode: 'photo', selection: { kind: 'composed', skin: 'skin_2', hat: 'hat_toghu', outfit: 'outfit_obom' }, frame: null };
    expect(studioAction(draft, CATALOG, 0, false)).toEqual({ kind: 'needPhoto' });
    expect(studioAction(draft, CATALOG, 0, true)).toEqual({ kind: 'save' });
    expect(saveRequest(draft)).toEqual({ mode: 'photo', frame: null });
  });

  it('un avatar prêt se dessine sur son fond de tissu', () => {
    expect(previewSpec({ kind: 'preset', preset: 'preset_notable' }, CATALOG)).toEqual({
      kind: 'preset',
      skin: 2,
      hat: { fabric: 'obom', shape: 'toque' },
      outfit: 'ndop',
      background: 'toghu',
    });
    expect(saveRequest({ mode: 'avatar', selection: { kind: 'preset', preset: 'preset_notable' }, frame: 'frame_toghu' })).toEqual({
      mode: 'avatar',
      selection: { kind: 'preset', preset: 'preset_notable' },
      frame: 'frame_toghu',
    });
  });
});

describe('Boutique d\'avatars', () => {
  it('met l\'édition limitée en bannière et filtre la grille par rareté', () => {
    expect(featuredEdition(CATALOG.presets)?.code).toBe('preset_prince_wouri');
    expect(shopGrid(CATALOG.presets, 'all').map((p) => p.code)).toEqual(['preset_debrouillard', 'preset_notable']);
    expect(shopGrid(CATALOG.presets, 'epique').map((p) => p.code)).toEqual(['preset_notable']);
    expect(shopGrid(CATALOG.presets, 'legendaire')).toEqual([]);
  });

  it('bouton : à toi, prix en or si le solde suffit, grisé sinon', () => {
    const by = CATALOG.byCode;
    expect(shopButton(by.get('preset_debrouillard') as ShopItem, 2450)).toBe('owned');
    expect(shopButton(by.get('preset_notable') as ShopItem, 2450)).toBe('affordable');
    expect(shopButton(by.get('preset_notable') as ShopItem, 1000)).toBe('tooExpensive');
    expect(shopButton(by.get('frame_trone_du_fon') as ShopItem, 99999)).toBe('locked');
    expect(shopButton({ ...(by.get('preset_prince_wouri') as ShopItem), edition: { total: 500, sold: 500 }, buyable: false }, 9999)).toBe('soldOut');
  });
});

describe('apparence du serveur → Avatar du kit', () => {
  it('convertit chaque sorte d\'image et le cadre', () => {
    expect(toAvatarSpec({ kind: 'photo', url: 'https://k/p.webp' })).toEqual({ kind: 'photo', uri: 'https://k/p.webp' });
    expect(toAvatarSpec({ kind: 'composed', skin: 4, hat: null, outfit: 'kaba' })).toEqual({ kind: 'composed', skin: 4, hat: null, outfit: 'kaba' });
    expect(
      avatarProps({
        avatar: { kind: 'preset', code: 'preset_fon', skin: 3, hat: { fabric: 'ndop', shape: 'couronne' }, outfit: 'ndop', background: 'toghu' },
        frame: { code: 'frame_trone_du_fon', fabric: 'toghu', rarity: 'legendaire' },
      }),
    ).toEqual({
      avatar: { kind: 'preset', skin: 3, hat: { fabric: 'ndop', shape: 'couronne' }, outfit: 'ndop', background: 'toghu' },
      frame: 'toghu',
      frameRarity: 'legendaire',
    });
    expect(avatarProps(null)).toEqual({ avatar: { kind: 'initial' }, frame: null, frameRarity: null });
  });
});
