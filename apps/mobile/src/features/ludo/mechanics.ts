/**
 * Tableau des mécanismes (écran 20b, planches LudoVariantes et VariantesLudo) et résumé des
 * règles (écrans 20 et 23), en clés de traduction du catalogue `ludo`. Module pur.
 */
import { PRESETS } from '@kwatt/rules-ludo';
import { ruleValue, type HouseRuleKey, type LudoSetup, type Preset } from './setup';

export type MechanicRow = 'exit' | 'capture' | 'protection' | 'barriers' | 'throw' | 'victory' | 'parties';
export const MECHANIC_ROWS: readonly MechanicRow[] = ['exit', 'capture', 'protection', 'barriers', 'throw', 'victory', 'parties'];

export interface MechanicLine {
  row: MechanicRow;
  /** Clé de la valeur dans le catalogue `ludo` (ex. `mech.exit.six`). */
  valueKey: string;
  params?: Record<string, number>;
  /** Réglage modifiable en règles maison (les 4 premiers). */
  editable: boolean;
  /** Valeur changée par les règles maison. */
  changed: boolean;
}

const EDITABLE: readonly MechanicRow[] = ['exit', 'capture', 'protection', 'barriers'];

/**
 * Segment de clé d'une valeur : « six_or_one » deviendrait un pluriel pour i18next
 * (suffixe « _one »), on l'écrit « six_or_1 ».
 */
export function valueSlug(value: string): string {
  return value.replace(/_one$/, '_1');
}

/** Clé de traduction d'une valeur de réglage maison. */
export function ruleValueKey(rule: HouseRuleKey, value: string): string {
  return `mech.${rule}.${valueSlug(value)}`;
}

export function mechanicLines(setup: Pick<LudoSetup, 'preset' | 'house'>): MechanicLine[] {
  const p = PRESETS[setup.preset];
  return MECHANIC_ROWS.map((row): MechanicLine => {
    if ((EDITABLE as readonly string[]).includes(row)) {
      const rule = row as HouseRuleKey;
      return { row, valueKey: ruleValueKey(rule, ruleValue(setup, rule)), editable: true, changed: setup.house?.[rule] !== undefined };
    }
    if (row === 'throw') {
      const key = p.mechanics.throw === 'cowries' ? 'cowries' : p.mechanics.thirdSix === 'last_moved_home' ? 'dice_third_six' : 'dice';
      return { row, valueKey: `mech.throw.${key}`, editable: false, changed: false };
    }
    if (row === 'victory') {
      return p.teamsRequired
        ? { row, valueKey: 'mech.victory.team', params: { count: 2 * p.mechanics.tokensPerPlayer }, editable: false, changed: false }
        : { row, valueKey: 'mech.victory.tokens', params: { count: p.mechanics.tokensPerPlayer }, editable: false, changed: false };
    }
    return { row, valueKey: `mech.parties.${setup.preset}`, editable: false, changed: false };
  });
}

/**
 * Résumé en trois points de l'écran 20 (« un 6 pour sortir, un 6 rejoue, cases étoilées
 * protégées ») : clés `summary.*` selon les réglages effectifs.
 */
export function summaryKeys(setup: Pick<LudoSetup, 'preset' | 'house'>): string[] {
  const p = PRESETS[setup.preset];
  const exit = ruleValue(setup, 'exit');
  const out = [`summary.exit.${valueSlug(exit)}`];
  out.push(p.mechanics.throw === 'cowries' ? 'summary.again.grace' : 'summary.again.six');
  out.push(`summary.protection.${ruleValue(setup, 'protection')}`);
  return out;
}

/** Règles détaillées de l'onglet Ludo de l'écran 23 (6 points, planche Regles). */
export const LUDO_RULE_POINTS = ['exit', 'again', 'capture', 'safe', 'enter', 'win'] as const;

/** Variantes du Ludo dans l'ordre de la planche VariantesLudo (écran 23, onglet Ludo). */
export const VARIANT_TABLE: readonly Preset[] = ['classique', 'rapide', 'parchis', 'pachisi', 'six'];
