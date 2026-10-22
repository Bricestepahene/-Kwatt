/**
 * Niveaux et échelons (SPEC §7, D-06, planche « 41 Échelons »).
 *
 * - Niveau = max(1, ⌊(force − 800) ÷ 40⌋) : Niv 17 à 1 482, Niv 18 à 1 520.
 * - Échelons : Apprenti 1–4, Débrouillard 5–9, Ancien du kwatt 10–14,
 *   Notable 15–19, Chef 20–24, Fon 25 et plus.
 *
 * Aucun texte affichable ici : les noms et les déblocages sont des codes que
 * l'appli traduit (`rank.apprenti`, `unlock.public_league_creation`…).
 */

export const LEVEL_BASE_RATING = 800;
export const RATING_PER_LEVEL = 40;

export function levelFromRating(rating: number): number {
  return Math.max(1, Math.floor((rating - LEVEL_BASE_RATING) / RATING_PER_LEVEL));
}

/** Force minimale pour atteindre un niveau (le niveau 1 commence en dessous de 880). */
export function ratingForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new Error('Niveau invalide');
  return level === 1 ? -Infinity : LEVEL_BASE_RATING + RATING_PER_LEVEL * level;
}

/**
 * « Encore 38 points de force pour Niv. 18 » (écran 09) : points qui manquent
 * pour passer au niveau suivant.
 */
export function pointsToNextLevel(rating: number): { nextLevel: number; points: number } {
  const nextLevel = levelFromRating(rating) + 1;
  return { nextLevel, points: ratingForLevel(nextLevel) - rating };
}

export const RANK_IDS = ['apprenti', 'debrouillard', 'ancien', 'notable', 'chef', 'fon'] as const;
export type RankId = (typeof RANK_IDS)[number];

/** Ce qu'un échelon débloque (planche Échelons, SPEC §7). Codes traduits par l'appli. */
export type UnlockCode =
  | 'unlock.basic_board'
  | 'unlock.bets_100'
  | 'unlock.public_league_creation'
  | 'unlock.table_wouri'
  | 'unlock.table_mont_cameroun'
  | 'unlock.machine_fon'
  | 'unlock.trone_du_fon'
  | 'unlock.legendary_frame';

export interface Rank {
  id: RankId;
  /** Position dans l'ordre des échelons (0 = Apprenti). */
  index: number;
  minLevel: number;
  /** null : pas de plafond (Fon). */
  maxLevel: number | null;
  /** Limite de mise d'une table dont l'échelon le plus bas est celui-ci (SPEC §7, D-07). */
  tableLimit: number;
  /** Nom de la table débloquée, s'il y en a un (« Table du Wouri »…). */
  tableName: 'table_wouri' | 'table_mont_cameroun' | 'trone_du_fon' | null;
  /** Comportement de la machine à cet échelon (planche Échelons) : clé de traduction. */
  machineBehaviour: string;
  unlocks: UnlockCode[];
}

export const RANKS: readonly Rank[] = [
  { id: 'apprenti', index: 0, minLevel: 1, maxLevel: 4, tableLimit: 50, tableName: null, machineBehaviour: 'rank.machine.apprenti', unlocks: ['unlock.basic_board'] },
  { id: 'debrouillard', index: 1, minLevel: 5, maxLevel: 9, tableLimit: 100, tableName: null, machineBehaviour: 'rank.machine.debrouillard', unlocks: ['unlock.bets_100'] },
  { id: 'ancien', index: 2, minLevel: 10, maxLevel: 14, tableLimit: 200, tableName: null, machineBehaviour: 'rank.machine.ancien', unlocks: ['unlock.public_league_creation'] },
  { id: 'notable', index: 3, minLevel: 15, maxLevel: 19, tableLimit: 500, tableName: 'table_wouri', machineBehaviour: 'rank.machine.notable', unlocks: ['unlock.table_wouri'] },
  { id: 'chef', index: 4, minLevel: 20, maxLevel: 24, tableLimit: 2000, tableName: 'table_mont_cameroun', machineBehaviour: 'rank.machine.chef', unlocks: ['unlock.table_mont_cameroun', 'unlock.machine_fon'] },
  { id: 'fon', index: 5, minLevel: 25, maxLevel: null, tableLimit: 5000, tableName: 'trone_du_fon', machineBehaviour: 'rank.machine.fon', unlocks: ['unlock.trone_du_fon', 'unlock.legendary_frame'] },
];

export function rankById(id: RankId): Rank {
  const rank = RANKS.find((r) => r.id === id);
  if (!rank) throw new Error(`Échelon inconnu : ${id}`);
  return rank;
}

export function rankForLevel(level: number): Rank {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    const r = RANKS[i]!;
    if (level >= r.minLevel) return r;
  }
  return RANKS[0]!;
}

export function rankForRating(rating: number): Rank {
  return rankForLevel(levelFromRating(rating));
}

/** Vrai si l'échelon `have` est au moins `need`. */
export function rankAtLeast(have: RankId, need: RankId): boolean {
  return rankById(have).index >= rankById(need).index;
}

/** Échelon le plus bas d'une liste (pour la limite de table). */
export function lowestRank(ranks: readonly RankId[]): Rank {
  if (ranks.length === 0) throw new Error('Liste d’échelons vide');
  return ranks.map(rankById).reduce((a, b) => (b.index < a.index ? b : a));
}

/** Tous les déblocages acquis à un échelon (cumulés depuis Apprenti). */
export function unlocksUpTo(id: RankId): UnlockCode[] {
  const max = rankById(id).index;
  return RANKS.filter((r) => r.index <= max).flatMap((r) => r.unlocks);
}

/** Créer une ligue publique : échelon Ancien du kwatt au moins (planche Matrice). */
export const PUBLIC_LEAGUE_CREATOR_MIN_RANK: RankId = 'ancien';

/** Résumé affiché par l'écran 09 / 41 pour une force donnée. */
export interface Standing {
  rating: number;
  level: number;
  rank: RankId;
  nextLevel: number;
  pointsToNextLevel: number;
}

export function standingFor(rating: number): Standing {
  const level = levelFromRating(rating);
  const next = pointsToNextLevel(rating);
  return { rating, level, rank: rankForLevel(level).id, nextLevel: next.nextLevel, pointsToNextLevel: next.points };
}
