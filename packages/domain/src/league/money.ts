/**
 * Argent d'une ligue publique (planche « Réf · Ligue publique », RegleLigues).
 *
 * - Caution du créateur = 50 cauris × places max (rendue à la clôture).
 * - Pot = inscrits × entrée + bonus Kwatt de 25 %.
 * - Partage : 1er 35 %, 2e 20 %, 3e 10 %, participation 30 % (entre ceux qui
 *   jouent tous leurs matchs), créateur 5 %.
 * - Arrondis au cauris inférieur, les restes vont au 1er.
 * - Forfait : amende de 10 % de l'entrée, versée au pot.
 * - Exclusion : remboursement = ½ × entrée × matchs restants ÷ matchs totaux ;
 *   le reste de son entrée et ses amendes restent au pot.
 */

export const CAUTION_PER_PLACE = 50;
export const KWATT_BONUS_PERCENT = 25;
export const FORFEIT_FINE_PERCENT = 10;
/** Parts du pot, en pourcentage. */
export const POT_SHARES = { first: 35, second: 20, third: 10, participation: 30, creator: 5 } as const;
/** Délai de validation par le créateur après la clôture des inscriptions. */
export const VALIDATION_DELAY_HOURS = 48;

export function leagueCaution(maxPlaces: number): number {
  if (!Number.isInteger(maxPlaces) || maxPlaces < 2) throw new Error('Nombre de places invalide');
  return CAUTION_PER_PLACE * maxPlaces;
}

/** Minimum d'inscrits pour démarrer (écran 31) : max(4, ⌈places ÷ 2⌉). */
export function leagueMinimumPlayers(maxPlaces: number): number {
  return Math.max(4, Math.ceil(maxPlaces / 2));
}

export function kwattBonus(entrants: number, entry: number): number {
  return Math.floor((entrants * entry * KWATT_BONUS_PERCENT) / 100);
}

/** Pot de départ : inscrits × entrée + 25 %. */
export function leaguePot(entrants: number, entry: number): number {
  return entrants * entry + kwattBonus(entrants, entry);
}

export function forfeitFine(entry: number): number {
  return Math.floor((entry * FORFEIT_FINE_PERCENT) / 100);
}

/** Remboursement d'un exclu : ½ × entrée × restants ÷ totaux, au cauris inférieur. */
export function exclusionRefund(entry: number, remainingMatches: number, totalMatches: number): number {
  if (totalMatches <= 0 || remainingMatches < 0 || remainingMatches > totalMatches) throw new Error('Nombre de matchs invalide');
  return Math.floor((entry * remainingMatches) / (2 * totalMatches));
}

export interface PotMovement {
  kind: 'entry' | 'kwatt_bonus' | 'fine' | 'exclusion_refund';
  amount: number;
}

/** Pot courant : somme des mouvements (le remboursement d'un exclu sort du pot). */
export function potBalance(movements: readonly PotMovement[]): number {
  return movements.reduce((sum, m) => sum + (m.kind === 'exclusion_refund' ? -m.amount : m.amount), 0);
}

export interface PotSplitInput {
  pot: number;
  /** Classement final : identifiants dans l'ordre (1er d'abord). */
  ranking: readonly string[];
  /** Joueurs qui ont joué tous leurs matchs (ni forfait ni exclusion). */
  finishers: readonly string[];
  creatorId: string;
}

export interface PotSplit {
  /** Montant versé à chaque joueur (le créateur compris s'il touche sa part). */
  payouts: Record<string, number>;
  first: number;
  second: number;
  third: number;
  /** Part de participation de chacun. */
  participationEach: number;
  creator: number;
  /** Restes des arrondis, ajoutés au 1er. */
  remainder: number;
}

/**
 * Partage du pot à la clôture. Exemple de la planche : pot 3 500, 12 joueurs
 * au bout → 1 225 (+6 de restes) / 700 / 350 / 87 chacun / 175.
 * Une place du podium sans joueur (ligue très courte) et une participation sans
 * aucun joueur allé au bout reviennent au 1er, comme les restes.
 */
export function splitPot(input: PotSplitInput): PotSplit {
  const { pot, ranking, finishers, creatorId } = input;
  if (ranking.length === 0) throw new Error('Classement vide');
  const share = (pct: number): number => Math.floor((pot * pct) / 100);
  const first = share(POT_SHARES.first);
  const second = ranking.length > 1 ? share(POT_SHARES.second) : 0;
  const third = ranking.length > 2 ? share(POT_SHARES.third) : 0;
  const participationPool = share(POT_SHARES.participation);
  const participationEach = finishers.length > 0 ? Math.floor(participationPool / finishers.length) : 0;
  const creator = share(POT_SHARES.creator);

  const payouts: Record<string, number> = {};
  const add = (id: string, amount: number): void => {
    payouts[id] = (payouts[id] ?? 0) + amount;
  };
  add(ranking[0]!, first);
  if (ranking[1] !== undefined) add(ranking[1], second);
  if (ranking[2] !== undefined) add(ranking[2], third);
  for (const id of finishers) add(id, participationEach);
  add(creatorId, creator);
  const distributed = first + second + third + participationEach * finishers.length + creator;
  const remainder = pot - distributed;
  add(ranking[0]!, remainder);
  return { payouts, first, second, third, participationEach, creator, remainder };
}

/**
 * Le créateur annule après validation : chaque inscrit récupère son entrée, et
 * la caution est partagée entre eux (au cauris inférieur ; les restes vont aux
 * premiers inscrits, un cauris chacun, dans l'ordre d'inscription).
 */
export function cancelAfterValidation(caution: number, entry: number, entrantsInOrder: readonly string[]): Record<string, number> {
  const n = entrantsInOrder.length;
  const out: Record<string, number> = {};
  if (n === 0) return out;
  const each = Math.floor(caution / n);
  let rest = caution - each * n;
  for (const id of entrantsInOrder) {
    out[id] = entry + each + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
  }
  return out;
}

export type ValidationOutcome = 'validated' | 'cancelled_not_enough_players' | 'cancelled_not_validated';

/**
 * Validation sous 48 h (étape 4) : moins que le minimum d'inscrits, ou pas de
 * validation à temps, et la ligue est annulée avec remboursement total.
 */
export function validationOutcome(input: {
  entrants: number;
  maxPlaces: number;
  validatedAt: number | null;
  registrationClosedAt: number;
}): ValidationOutcome {
  if (input.entrants < leagueMinimumPlayers(input.maxPlaces)) return 'cancelled_not_enough_players';
  const deadline = input.registrationClosedAt + VALIDATION_DELAY_HOURS * 3_600_000;
  if (input.validatedAt === null || input.validatedAt > deadline) return 'cancelled_not_validated';
  return 'validated';
}

/** Inscription : le solde doit couvrir l'entrée (la mise est bloquée tout de suite). */
export function canAffordEntry(balance: number, entry: number): { ok: boolean; missing: number } {
  return { ok: balance >= entry, missing: Math.max(0, entry - balance) };
}
