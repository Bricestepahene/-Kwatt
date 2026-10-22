/**
 * Mise en place d'une partie de Ludo : variante, règles maison, nombre de machines.
 * Module pur (sans React Native) : testé par vitest.
 *
 * La variante courante (« Classique · changer » de l'écran 20) est choisie à l'écran 20b et
 * gardée sur l'appareil (setupStore.ts).
 */
import {
  houseRuleOptions,
  isRanked,
  normalizeHouseRules,
  PRESET_IDS,
  PRESETS,
  validateSetup,
  type HouseRules,
  type NewGameOptions,
  type Preset,
  type SetupCheck,
} from '@kwatt/rules-ludo';

export type { HouseRules, Preset };

/** Variante courante, avec ses règles maison éventuelles. */
export interface LudoSetup {
  preset: Preset;
  /** Règles maison normalisées (seulement ce qui diffère de la variante), null sinon. */
  house: HouseRules | null;
  /** Jeu de règles enregistré d'où viennent les règles maison (« les règles de Tata Odile »). */
  houseSet: { id: string; name: string } | null;
}

export const DEFAULT_SETUP: Readonly<LudoSetup> = Object.freeze({ preset: 'classique', house: null, houseSet: null });

/** Ordre d'affichage des plateaux (planche LudoVariantes). */
export const PRESET_ORDER: readonly Preset[] = ['classique', 'rapide', 'parchis', 'pachisi', 'six'];

/** Identifiant de variante côté serveur (C1, C2, C3) : `ludo_classique`, `ludo_six`… */
export function variantId(preset: Preset): string {
  return `ludo_${preset}`;
}

export function presetOfVariant(variant: string): Preset | null {
  const p = variant.startsWith('ludo_') ? variant.slice(5) : variant;
  return (PRESET_IDS as readonly string[]).includes(p) ? (p as Preset) : null;
}

/** Variante classée (force, ligues, mises) : Classique, Rapide, 6 joueurs, sans règles maison. */
export function isRankedSetup(setup: Pick<LudoSetup, 'preset' | 'house'>): boolean {
  return isRanked({ preset: setup.preset, house: setup.house });
}

/** Pachisi : toujours 2 contre 2, donc 3 machines (ton partenaire en est une). */
export function machineCounts(preset: Preset): number[] {
  if (preset === 'pachisi') return [3];
  const [min, max] = PRESETS[preset].players;
  const out: number[] = [];
  for (let n = Math.max(1, min - 1); n <= Math.min(3, max - 1); n++) out.push(n);
  return out;
}

export function clampMachines(preset: Preset, machines: number): number {
  const counts = machineCounts(preset);
  if (counts.includes(machines)) return machines;
  return counts[counts.length - 1]!;
}

/**
 * Options de @kwatt/rules-ludo pour une partie contre `machines` machines : le joueur au
 * siège 0, les machines aux sièges suivants ; Pachisi en équipes face à face.
 */
export function gameOptions(setup: Pick<LudoSetup, 'preset' | 'house'>, machines: number): NewGameOptions {
  const players = 1 + clampMachines(setup.preset, machines);
  const teams = setup.preset === 'pachisi' ? { teams: [[0, 2], [1, 3]] } : {};
  return { preset: setup.preset, players, ...teams, house: setup.house };
}

/** Sièges de l'équipe du joueur (siège 0), vide sans équipes. */
export function myTeam(options: Pick<NewGameOptions, 'teams'>): number[] {
  return options.teams?.find((t) => t.includes(0)) ?? [];
}

export type HouseRuleKey = keyof HouseRules;
export const HOUSE_RULE_KEYS: readonly HouseRuleKey[] = ['exit', 'capture', 'protection', 'barriers'];

/** Valeur effective d'un réglage maison (règles maison sinon valeur de la variante). */
export function ruleValue(setup: Pick<LudoSetup, 'preset' | 'house'>, rule: HouseRuleKey): string {
  const opt = houseRuleOptions(setup.preset).find((o) => o.rule === rule)!;
  return setup.house?.[rule] ?? opt.default;
}

export interface RuleChoice {
  value: string;
  /** Valeur de la variante officielle. */
  isDefault: boolean;
  /** Choix refusé (combinaison bloquée) : code d'erreur de @kwatt/rules-ludo. */
  blocked: SetupCheck & { ok: false } | null;
}

/** Choix possibles d'un réglage maison, avec les combinaisons bloquées (écran 20b, « Personnaliser »). */
export function ruleChoices(setup: Pick<LudoSetup, 'preset' | 'house'>, rule: HouseRuleKey): RuleChoice[] {
  const opt = houseRuleOptions(setup.preset).find((o) => o.rule === rule)!;
  return opt.options.map((value) => {
    const house = withRule(setup, rule, value);
    const check = validateSetup(setupCheckOptions(setup.preset, house));
    return { value, isDefault: value === opt.default, blocked: check.ok ? null : check };
  });
}

/** Règles maison après le changement d'un réglage (normalisées). */
export function withRule(setup: Pick<LudoSetup, 'preset' | 'house'>, rule: HouseRuleKey, value: string): HouseRules | null {
  return normalizeHouseRules(setup.preset, { ...(setup.house ?? {}), [rule]: value } as HouseRules);
}

/** Mise en place minimale pour vérifier des règles maison seules (même choix que le serveur). */
export function setupCheckOptions(preset: Preset, house: HouseRules | null): NewGameOptions {
  if (preset === 'pachisi') return { preset, players: 4, teams: [[0, 2], [1, 3]], house };
  return { preset, players: 2, house };
}

/** Changer de plateau : les règles maison qui n'y valent plus sont retirées. */
export function changePreset(setup: LudoSetup, preset: Preset): LudoSetup {
  if (preset === setup.preset) return setup;
  const house = normalizeHouseRules(preset, setup.house);
  const ok = house === null || validateSetup(setupCheckOptions(preset, house)).ok;
  return { preset, house: ok ? house : null, houseSet: ok ? setup.houseSet : null };
}

/** Niveau d'une force (SPEC §7, D-06) : max(1, ⌊(force − 800) ÷ 40⌋). */
export function levelFromRating(rating: number): number {
  return Math.max(1, Math.floor((rating - 800) / 40));
}

/** Lit une mise en place gardée (tolérant : stockage ancien ou abîmé → valeurs par défaut). */
export function sanitizeSetup(raw: unknown): LudoSetup {
  const r = (raw ?? {}) as Partial<LudoSetup>;
  const preset = (PRESET_IDS as readonly unknown[]).includes(r.preset) ? (r.preset as Preset) : DEFAULT_SETUP.preset;
  let house = r.house && typeof r.house === 'object' ? normalizeHouseRules(preset, r.house) : null;
  if (house && !validateSetup(setupCheckOptions(preset, house)).ok) house = null;
  const hs = r.houseSet;
  const houseSet = house && hs && typeof hs.id === 'string' && typeof hs.name === 'string' ? { id: hs.id, name: hs.name } : null;
  return { preset, house, houseSet };
}
