/**
 * Quêtes de la semaine, séries de jours et problème du jour (écrans 19b et 40).
 *
 * - Série de jours : un jour compte s'il y a une activité (partie terminée ou
 *   problème du jour tenté). 7 jours de suite → une carte rare au choix ; la
 *   récompense revient à chaque multiple de 7 (14, 21…) tant que la série dure.
 * - Problème du jour résolu : +10 cauris (une fois par jour).
 * - Quêtes de la semaine (lundi → dimanche) : montants de l'écran 40.
 */

export const STREAK_REWARD_EVERY = 7;
export const DAILY_PUZZLE_REWARD = 10;

export interface DayStreak {
  /** Dernier jour d'activité (numéro de jour, voir `dayNumber`), null si jamais. */
  lastDay: number | null;
  /** Jours de suite, le dernier compris. */
  length: number;
}

export interface StreakUpdate {
  streak: DayStreak;
  /** Ce jour donne droit à la carte rare au choix. */
  rareCardEarned: boolean;
  /** Le jour était déjà compté (aucun changement). */
  alreadyCounted: boolean;
}

/** Enregistre une activité le jour `today` (numéro de jour). */
export function recordActiveDay(streak: DayStreak, today: number): StreakUpdate {
  if (streak.lastDay === today) return { streak, rareCardEarned: false, alreadyCounted: true };
  if (streak.lastDay !== null && today < streak.lastDay) throw new Error('Jour antérieur au dernier jour compté');
  const length = streak.lastDay !== null && today === streak.lastDay + 1 ? streak.length + 1 : 1;
  return { streak: { lastDay: today, length }, rareCardEarned: length % STREAK_REWARD_EVERY === 0, alreadyCounted: false };
}

/** Longueur affichée aujourd'hui : la série tombe à 0 si hier n'a pas été joué. */
export function currentStreak(streak: DayStreak, today: number): number {
  if (streak.lastDay === null) return 0;
  return today - streak.lastDay <= 1 ? streak.length : 0;
}

/** Jours restants avant la prochaine carte rare (« Au 7e jour »). */
export function daysToNextStreakReward(length: number): number {
  return STREAK_REWARD_EVERY - (length % STREAK_REWARD_EVERY);
}

export type QuestGame = 'dames' | 'ludo' | 'any';

export type QuestEvent =
  | { kind: 'game_won'; game: 'dames' | 'ludo' }
  /** Aller-retour gagné (salon ou défi en aller-retour). */
  | { kind: 'two_leg_won'; game: 'dames' | 'ludo' }
  /** Prise de plusieurs pièces d'un coup (rafle) aux Dames. */
  | { kind: 'capture'; game: 'dames'; count: number }
  | { kind: 'puzzle_solved' };

export type QuestReward = { kind: 'cauris'; amount: number } | { kind: 'card'; rarity: 'rare' };

export interface QuestDefinition {
  id: string;
  kind: 'win_games' | 'win_two_leg' | 'capture_at_least' | 'solve_puzzles';
  game: QuestGame;
  /** Nombre à atteindre (parties, aller-retour, problèmes) ; pour une rafle, 1. */
  target: number;
  /** Rafle : nombre minimal de pièces prises d'un coup. */
  minCount?: number;
  reward: QuestReward;
}

/** Quêtes de l'écran 40. */
export const WEEKLY_QUESTS: readonly QuestDefinition[] = [
  { id: 'win_3_ludo', kind: 'win_games', game: 'ludo', target: 3, reward: { kind: 'cauris', amount: 50 } },
  { id: 'win_two_leg', kind: 'win_two_leg', game: 'any', target: 1, reward: { kind: 'card', rarity: 'rare' } },
  { id: 'rafle_3', kind: 'capture_at_least', game: 'dames', target: 1, minCount: 3, reward: { kind: 'cauris', amount: 80 } },
];

function matchesGame(def: QuestDefinition, game: 'dames' | 'ludo'): boolean {
  return def.game === 'any' || def.game === game;
}

/** Avancement d'une quête à partir des événements de la semaine. */
export function questProgress(def: QuestDefinition, events: readonly QuestEvent[]): { progress: number; target: number; done: boolean } {
  let progress = 0;
  for (const e of events) {
    switch (def.kind) {
      case 'win_games':
        if (e.kind === 'game_won' && matchesGame(def, e.game)) progress++;
        break;
      case 'win_two_leg':
        if (e.kind === 'two_leg_won' && matchesGame(def, e.game)) progress++;
        break;
      case 'capture_at_least':
        if (e.kind === 'capture' && e.count >= (def.minCount ?? 1)) progress++;
        break;
      case 'solve_puzzles':
        if (e.kind === 'puzzle_solved') progress++;
        break;
    }
  }
  progress = Math.min(progress, def.target);
  return { progress, target: def.target, done: progress >= def.target };
}
