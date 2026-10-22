/**
 * Logique du Studio d'avatar (écran 10) et de la Boutique (écran 11), sans React Native :
 * catalogue rangé par famille, brouillon de l'avatar, aperçu, pièces à acheter et action
 * principale (« Enregistrer » ou « Acheter · X cauris »). Testé par vitest.
 */
import {
  FrameItemRenderSchema,
  HatItemRenderSchema,
  OutfitItemRenderSchema,
  PresetItemRenderSchema,
  SkinItemRenderSchema,
  type AvatarMode,
  type AvatarSelection,
  type ItemRarity,
  type MyAvatar,
  type SaveAvatarRequest,
  type ShopItem,
} from '@kwatt/protocol';
import type { FabricName } from '@kwatt/design';
import type { AvatarHatSpec, AvatarSkin, AvatarSpec } from '../../ui/Avatar';

/** Familles du catalogue utiles au Studio et à la Boutique. */
export const STUDIO_KINDS = ['avatar_skin', 'avatar_hat', 'avatar_outfit', 'avatar_preset', 'frame'] as const;

export interface StudioCatalog {
  skins: ShopItem[];
  hats: ShopItem[];
  outfits: ShopItem[];
  presets: ShopItem[];
  frames: ShopItem[];
  byCode: ReadonlyMap<string, ShopItem>;
}

const byOrder = (a: ShopItem, b: ShopItem) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);

export function splitCatalog(items: readonly ShopItem[]): StudioCatalog {
  const sorted = [...items].sort(byOrder);
  return {
    skins: sorted.filter((i) => i.kind === 'avatar_skin'),
    hats: sorted.filter((i) => i.kind === 'avatar_hat'),
    outfits: sorted.filter((i) => i.kind === 'avatar_outfit'),
    presets: sorted.filter((i) => i.kind === 'avatar_preset'),
    frames: sorted.filter((i) => i.kind === 'frame'),
    byCode: new Map(sorted.map((i) => [i.code, i])),
  };
}

// --- Données de rendu ----------------------------------------------------------------------

export function skinTone(item: ShopItem | undefined): AvatarSkin {
  const r = SkinItemRenderSchema.safeParse(item?.render);
  return (r.success ? r.data.tone : 2) as AvatarSkin;
}

export function hatRender(item: ShopItem | undefined): AvatarHatSpec | null {
  const r = HatItemRenderSchema.safeParse(item?.render);
  return r.success ? { fabric: r.data.fabric as FabricName, shape: r.data.shape } : null;
}

export function fabricOf(item: ShopItem | undefined): FabricName | null {
  const outfit = OutfitItemRenderSchema.safeParse(item?.render);
  if (outfit.success) return outfit.data.fabric;
  const frame = FrameItemRenderSchema.safeParse(item?.render);
  return frame.success ? frame.data.fabric : null;
}

/** Avatar prêt → spécification de dessin. */
export function presetSpec(item: ShopItem | undefined): AvatarSpec {
  const r = PresetItemRenderSchema.safeParse(item?.render);
  if (!r.success) return { kind: 'initial' };
  const { skin, hat, outfit, background } = r.data;
  return {
    kind: 'preset',
    skin: skin as AvatarSkin,
    hat: hat ? { fabric: hat.fabric as FabricName, shape: hat.shape } : null,
    outfit,
    background,
  };
}

/** Événement d'une édition limitée (« ngondo_2026 »), ou null. */
export function presetEvent(item: ShopItem | undefined): string | null {
  const r = PresetItemRenderSchema.safeParse(item?.render);
  return r.success ? (r.data.event ?? null) : null;
}

// --- Brouillon du Studio -----------------------------------------------------------------

export type StudioSelection = Exclude<AvatarSelection, { kind: 'initial' }>;

export interface StudioDraft {
  mode: AvatarMode;
  selection: StudioSelection;
  frame: string | null;
}

/**
 * Composition proposée quand le joueur n'a encore rien choisi : teint du milieu, coiffe et
 * tenue de base (comme la planche : bonnet ndop, tenue obom).
 */
export function defaultComposition(catalog: StudioCatalog): StudioSelection {
  const skin = catalog.skins[Math.floor(catalog.skins.length / 2)] ?? catalog.skins[0];
  const hat = catalog.hats.find((h) => h.isDefault) ?? null;
  const outfit = catalog.outfits.find((o) => o.isDefault) ?? catalog.outfits[0];
  return { kind: 'composed', skin: skin?.code ?? 'skin_3', hat: hat?.code ?? null, outfit: outfit?.code ?? 'outfit_obom' };
}

export function initialDraft(mine: MyAvatar, catalog: StudioCatalog): StudioDraft {
  const selection = mine.selection.kind === 'initial' ? defaultComposition(catalog) : mine.selection;
  return { mode: mine.mode, selection, frame: mine.frame };
}

/** Composition actuelle (pour revenir du mode « avatar prêt » au mode composé). */
export function asComposition(selection: StudioSelection, catalog: StudioCatalog): Extract<StudioSelection, { kind: 'composed' }> {
  if (selection.kind === 'composed') return selection;
  const fallback = defaultComposition(catalog);
  return fallback.kind === 'composed' ? fallback : { kind: 'composed', skin: 'skin_3', hat: null, outfit: 'outfit_obom' };
}

/** Aperçu du brouillon (mode avatar). */
export function previewSpec(selection: StudioSelection, catalog: StudioCatalog): AvatarSpec {
  if (selection.kind === 'preset') return presetSpec(catalog.byCode.get(selection.preset));
  const outfit = fabricOf(catalog.byCode.get(selection.outfit)) ?? 'obom';
  return {
    kind: 'composed',
    skin: skinTone(catalog.byCode.get(selection.skin)),
    hat: selection.hat ? hatRender(catalog.byCode.get(selection.hat)) : null,
    outfit,
  };
}

/** Objets choisis dans le brouillon (pièces en mode avatar, et le cadre). */
export function selectedItems(draft: StudioDraft, catalog: StudioCatalog): ShopItem[] {
  const codes: string[] = [];
  if (draft.mode === 'avatar') {
    if (draft.selection.kind === 'preset') codes.push(draft.selection.preset);
    else {
      codes.push(draft.selection.skin);
      if (draft.selection.hat) codes.push(draft.selection.hat);
      codes.push(draft.selection.outfit);
    }
  }
  if (draft.frame) codes.push(draft.frame);
  return codes.map((c) => catalog.byCode.get(c)).filter((i): i is ShopItem => i !== undefined);
}

export interface PurchasePlan {
  /** Objets à acheter avant d'enregistrer. */
  items: ShopItem[];
  total: number;
  /** Cauris qui manquent (0 si le solde suffit). */
  missing: number;
  /** Objets choisis qui ne s'achètent pas (échelon trop bas, épuisés…) : enregistrement impossible. */
  blocked: ShopItem[];
}

export function purchasePlan(items: readonly ShopItem[], balance: number): PurchasePlan {
  const notOwned = items.filter((i) => !i.owned);
  const buyable = notOwned.filter((i) => i.buyable && i.price !== null);
  const blocked = notOwned.filter((i) => !(i.buyable && i.price !== null));
  const total = buyable.reduce((sum, i) => sum + (i.price ?? 0), 0);
  return { items: buyable, total, missing: Math.max(0, total - balance), blocked };
}

export type StudioAction =
  | { kind: 'save' }
  | { kind: 'buy'; total: number }
  | { kind: 'blocked'; item: ShopItem }
  | { kind: 'needPhoto' };

/** Action principale du Studio, comme la planche : « Enregistrer » ou « Acheter · X cauris ». */
export function studioAction(draft: StudioDraft, catalog: StudioCatalog, balance: number, hasPhoto: boolean): StudioAction {
  if (draft.mode === 'photo' && !hasPhoto) return { kind: 'needPhoto' };
  const plan = purchasePlan(selectedItems(draft, catalog), balance);
  const first = plan.blocked[0];
  if (first) return { kind: 'blocked', item: first };
  return plan.total > 0 ? { kind: 'buy', total: plan.total } : { kind: 'save' };
}

/** Corps de PUT /v1/me/avatar pour ce brouillon. */
export function saveRequest(draft: StudioDraft): SaveAvatarRequest {
  return draft.mode === 'photo' ? { mode: 'photo', frame: draft.frame } : { mode: 'avatar', selection: draft.selection, frame: draft.frame };
}

// --- Boutique ---------------------------------------------------------------------------------

export type ShopFilter = 'all' | Exclude<ItemRarity, 'commune'>;
export const SHOP_FILTERS: readonly ShopFilter[] = ['all', 'rare', 'epique', 'legendaire'];

/** Avatars prêts de la vitrine : hors édition limitée (montrée en bannière), filtrés par rareté. */
export function shopGrid(presets: readonly ShopItem[], filter: ShopFilter): ShopItem[] {
  return presets.filter((p) => p.edition === null && (filter === 'all' || p.rarity === filter));
}

/** Édition limitée mise en avant (la première encore en vente, sinon la première possédée). */
export function featuredEdition(presets: readonly ShopItem[]): ShopItem | null {
  const editions = presets.filter((p) => p.edition !== null);
  return editions.find((p) => p.buyable) ?? editions.find((p) => p.owned) ?? editions[0] ?? null;
}

/** État du bouton d'une vignette de la boutique. */
export type ShopButton = 'owned' | 'affordable' | 'tooExpensive' | 'locked' | 'soldOut' | 'unavailable';

export function shopButton(item: ShopItem, balance: number): ShopButton {
  if (item.owned) return 'owned';
  if (item.locked) return 'locked';
  if (item.edition && item.edition.sold >= item.edition.total) return 'soldOut';
  if (!item.buyable || item.price === null) return 'unavailable';
  return item.price > balance ? 'tooExpensive' : 'affordable';
}
