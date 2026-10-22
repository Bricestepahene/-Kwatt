/**
 * Défi contre la machine (écrans 14 et 15, SPEC §7) : difficultés, cotes,
 * gains de base, série ×1,5, plafond quotidien, difficulté automatique.
 *
 * Tous les montants sont des entiers (cauris), arrondis au cauris inférieur.
 */
import { winProbability } from './rating.js';
import { rankAtLeast, type RankId } from './ranks.js';

export const MACHINE_DIFFICULTY_IDS = ['facile', 'moyen', 'coriace', 'ton_niveau', 'fon'] as const;
export type MachineDifficultyId = (typeof MACHINE_DIFFICULTY_IDS)[number];

export interface MachineDifficulty {
  id: MachineDifficultyId;
  index: number;
  /** Chance de gagner visée pour le joueur. */
  p: number;
  /** Gain d'une victoire, sans pari. */
  baseReward: number;
  /** Échelon nécessaire pour la débloquer (Fon : échelon Chef). */
  requiredRank: RankId | null;
}

export const MACHINE_DIFFICULTIES: readonly MachineDifficulty[] = [
  { id: 'facile', index: 0, p: 0.9, baseReward: 25, requiredRank: null },
  { id: 'moyen', index: 1, p: 0.75, baseReward: 25, requiredRank: null },
  { id: 'coriace', index: 2, p: 0.6, baseReward: 40, requiredRank: null },
  { id: 'ton_niveau', index: 3, p: 0.5, baseReward: 60, requiredRank: null },
  { id: 'fon', index: 4, p: 0.2, baseReward: 100, requiredRank: 'chef' },
];

export function machineDifficulty(id: MachineDifficultyId): MachineDifficulty {
  const d = MACHINE_DIFFICULTIES.find((x) => x.id === id);
  if (!d) throw new Error(`Difficulté inconnue : ${id}`);
  return d;
}

export function isDifficultyUnlocked(id: MachineDifficultyId, rank: RankId): boolean {
  const need = machineDifficulty(id).requiredRank;
  return need === null || rankAtLeast(rank, need);
}

/** Force de la machine = ta force − 400 × log10(p ÷ (1 − p)), arrondie. */
export function machineRating(playerRating: number, p: number): number {
  if (!(p > 0 && p < 1)) throw new Error('Chance hors de ]0, 1[');
  return Math.round(playerRating - 400 * Math.log10(p / (1 - p)));
}

/** Plus grande valeur que peut prendre une cote, pour les chances infimes. */
export const MAX_ODDS_HUNDREDTHS = 100_000;

/**
 * Cote = 0,9 ÷ p, exprimée en centièmes entiers (1,8 → 180) pour que les
 * calculs de cauris restent exacts.
 */
export function oddsHundredths(p: number): number {
  if (!(p > 0 && p <= 1)) throw new Error('Chance hors de ]0, 1]');
  return Math.min(MAX_ODDS_HUNDREDTHS, Math.round(90 / p));
}

/** Cote décimale (affichage : « ×1,8 »). */
export function betOdds(p: number): number {
  return oddsHundredths(p) / 100;
}

/** Cote réelle d'un défi : à partir des forces du joueur et de la machine. */
export function oddsForRatings(playerRating: number, machineRatingValue: number): number {
  return betOdds(winProbability(playerRating, machineRatingValue));
}

/** Participation à une partie classée terminée (machine ou joueurs). */
export const PARTICIPATION_REWARD = 10;
/** Parties contre la machine récompensées, par jour et par jeu. */
export const DAILY_REWARDED_MACHINE_GAMES = 10;
/** Série de victoires contre la machine qui multiplie le gain suivant. */
export const STREAK_LENGTH = 3;
export const STREAK_MULTIPLIER_NUM = 3;
export const STREAK_MULTIPLIER_DEN = 2;

/**
 * Multiplicateur de série (×1,5) : s'applique à la victoire qui suit une série
 * de 3 victoires (puis à celle qui suit 6, 9…). `winStreakBefore` = victoires
 * de suite contre la machine avant cette partie.
 */
export function streakBonusApplies(winStreakBefore: number): boolean {
  return winStreakBefore > 0 && winStreakBefore % STREAK_LENGTH === 0;
}

export type MachineOutcome = 'win' | 'loss' | 'draw';

export interface MachineSettlementInput {
  difficulty: MachineDifficultyId;
  outcome: MachineOutcome;
  /** Pari en cauris (0 = sans pari). Interdit hors connexion (D-08). */
  bet: number;
  /** Cote en centièmes (`oddsHundredths`), figée au moment du pari. */
  oddsHundredths: number;
  /** Victoires de suite avant cette partie (série ×1,5). */
  winStreakBefore: number;
  /** Parties déjà récompensées aujourd'hui pour ce jeu. */
  rewardedToday: number;
  /** Partie jouée hors connexion : pas de pari (D-08), gains de base seulement. */
  offline?: boolean;
}

export interface MachineSettlement {
  /** Variation totale du solde à la fin de la partie (la mise est déjà bloquée : voir `betReturned`). */
  net: number;
  /** Gain de base (victoire), série comprise. */
  base: number;
  /** Participation (+10) : défaite ou nulle. */
  participation: number;
  /** Gain net du pari : mise × (cote − 1) si victoire, −mise si défaite, 0 si nulle. */
  betNet: number;
  /** La série ×1,5 a été appliquée. */
  streakBonus: boolean;
  /** Cette partie compte dans le plafond de 10 par jour. */
  counted: boolean;
}

/**
 * Règlement d'une partie contre la machine (écran 15) :
 * - victoire : gain de base (×1,5 après une série de 3) + mise × (cote − 1) ;
 * - défaite : +10 de participation − mise ;
 * - nulle (Dames) : +10 de participation, la mise est rendue ;
 * - au-delà de 10 parties récompensées dans la journée : ni gain de base ni
 *   participation, mais un pari se règle quand même (sa cote ne rapporte pas
 *   en moyenne : 0,9 ÷ p).
 */
export function settleMachineGame(input: MachineSettlementInput): MachineSettlement {
  if (!Number.isInteger(input.bet) || input.bet < 0) throw new Error('Pari invalide');
  if (input.offline && input.bet > 0) throw new Error('Pas de pari hors connexion');
  const d = machineDifficulty(input.difficulty);
  const counted = input.rewardedToday < DAILY_REWARDED_MACHINE_GAMES;
  let base = 0;
  let participation = 0;
  let betNet = 0;
  let streakBonus = false;
  if (input.outcome === 'win') {
    if (counted) {
      streakBonus = streakBonusApplies(input.winStreakBefore);
      base = streakBonus ? Math.floor((d.baseReward * STREAK_MULTIPLIER_NUM) / STREAK_MULTIPLIER_DEN) : d.baseReward;
    }
    betNet = Math.floor((input.bet * (input.oddsHundredths - 100)) / 100);
  } else {
    if (counted) participation = PARTICIPATION_REWARD;
    betNet = input.outcome === 'loss' ? -input.bet : 0;
  }
  return { net: base + participation + betNet, base, participation, betNet, streakBonus, counted };
}

/** Série de victoires après une partie (nulle et défaite remettent à zéro). */
export function nextWinStreak(winStreakBefore: number, outcome: MachineOutcome): number {
  return outcome === 'win' ? winStreakBefore + 1 : 0;
}

/**
 * Difficulté automatique (écran 14) : +1 cran après 3 victoires de suite,
 * −1 cran après 3 défaites de suite. `streak` > 0 : victoires de suite,
 * < 0 : défaites de suite. Une nulle remet le compteur à zéro. Après un
 * changement de cran, le compteur repart de zéro.
 */
export interface AutoDifficultyState {
  difficulty: MachineDifficultyId;
  streak: number;
}

export const AUTO_STEP_AFTER = 3;

export function applyAutoDifficulty(state: AutoDifficultyState, outcome: MachineOutcome, rank: RankId): AutoDifficultyState {
  let streak = state.streak;
  if (outcome === 'win') streak = streak > 0 ? streak + 1 : 1;
  else if (outcome === 'loss') streak = streak < 0 ? streak - 1 : -1;
  else streak = 0;

  const index = machineDifficulty(state.difficulty).index;
  const unlocked = MACHINE_DIFFICULTIES.filter((d) => isDifficultyUnlocked(d.id, rank));
  const maxIndex = unlocked[unlocked.length - 1]!.index;
  if (streak >= AUTO_STEP_AFTER) {
    const next = Math.min(maxIndex, index + 1);
    return { difficulty: MACHINE_DIFFICULTIES[next]!.id, streak: 0 };
  }
  if (streak <= -AUTO_STEP_AFTER) {
    const next = Math.max(0, index - 1);
    return { difficulty: MACHINE_DIFFICULTIES[next]!.id, streak: 0 };
  }
  return { difficulty: state.difficulty, streak };
}

/**
 * Gains affichés avant de jouer (écran 15) : « Si tu gagnes +220 » (gain de
 * base + gain net du pari), « Si tu perds −190 » (pari perdu, +10 de
 * participation). Sans série ni plafond atteint.
 */
export function machinePreview(difficulty: MachineDifficultyId, bet: number, oddsH: number): { ifWin: number; ifLoss: number } {
  const common = { difficulty, bet, oddsHundredths: oddsH, winStreakBefore: 0, rewardedToday: 0 };
  return {
    ifWin: settleMachineGame({ ...common, outcome: 'win' }).net,
    ifLoss: settleMachineGame({ ...common, outcome: 'loss' }).net,
  };
}

/** Objectif de mesure : 45 à 55 % de victoires à « Ton niveau » (SPEC §7, planche Moteur). */
export const CALIBRATION_TARGET = { min: 0.45, max: 0.55 } as const;

/** Suivi par variante : la machine « Ton niveau » est-elle bien réglée ? (null : pas assez de parties). */
export function calibrationStatus(wins: number, games: number, minGames = 50): 'too_easy' | 'ok' | 'too_hard' | null {
  if (games < minGames) return null;
  const rate = wins / games;
  if (rate > CALIBRATION_TARGET.max) return 'too_easy';
  if (rate < CALIBRATION_TARGET.min) return 'too_hard';
  return 'ok';
}

/** Résumé d'une difficulté pour l'écran 15 : force de la machine, cote, gain de base. */
export interface DifficultyOffer {
  id: MachineDifficultyId;
  machineRating: number;
  oddsHundredths: number;
  baseReward: number;
  unlocked: boolean;
}

export function difficultyOffers(playerRating: number, rank: RankId): DifficultyOffer[] {
  return MACHINE_DIFFICULTIES.map((d) => ({
    id: d.id,
    machineRating: machineRating(playerRating, d.p),
    oddsHundredths: oddsHundredths(d.p),
    baseReward: d.baseReward,
    unlocked: isDifficultyUnlocked(d.id, rank),
  }));
}
