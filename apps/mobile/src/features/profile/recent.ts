/**
 * Présentation de l'onglet d'un jeu du profil (écran 09) : pastille de résultat (V, N, D
 * ou place), « contre qui », contexte et points gagnés, comme la planche :
 *   V · contre Mireille · Défi · mise 200 · +200 cauris
 *   1er · Salon (4 joueurs) · pot 400 · +300 cauris
 * Les textes sont des clés du catalogue `profile` (recent.*), avec leurs paramètres.
 * Module pur, testé par vitest.
 */
import type { FamilyProfile, GameFamily, RecentGame } from '@kwatt/protocol';

export type ResultTone = 'gain' | 'alert' | 'muted';

/** Pastille : V / N / D aux Dames, place au Ludo (1er, 2e…). */
export function resultBadge(game: RecentGame): { kind: 'result'; result: RecentGame['result'] } | { kind: 'place'; place: number } {
  if (game.playerCount > 2 && game.place !== null) return { kind: 'place', place: game.place };
  return { kind: 'result', result: game.result };
}

/** Couleur de la pastille : premier ou victoire en vert, dernier ou défaite en corail, sinon gris. */
export function resultTone(game: RecentGame): ResultTone {
  if (game.playerCount > 2 && game.place !== null) {
    if (game.place === 1) return 'gain';
    if (game.place === game.playerCount) return 'alert';
    return 'muted';
  }
  return game.result === 'win' ? 'gain' : game.result === 'loss' ? 'alert' : 'muted';
}

export interface I18nLine {
  key: string;
  params?: Record<string, string | number>;
}

/** « contre Mireille », « contre la machine », « contre Mireille et 2 autres ». */
export function opponentLine(game: RecentGame): I18nLine {
  const humans = game.opponents.filter((o) => !o.machine);
  const machines = game.opponents.length - humans.length;
  if (humans.length === 0) return machines > 1 ? { key: 'recent.vsMachines', params: { count: machines } } : { key: 'recent.vsMachine' };
  const first = humans[0]?.name ?? '';
  const others = game.opponents.length - 1;
  if (first === '') return others > 0 ? { key: 'recent.vsFormerOthers', params: { count: others } } : { key: 'recent.vsFormer' };
  return others > 0 ? { key: 'recent.vsPlayerOthers', params: { name: first, count: others } } : { key: 'recent.vsPlayer', params: { name: first } };
}

/**
 * Contexte : défi avec mise, salon, ligue, machine. Le texte peut citer la variante :
 * l'appelant ajoute le paramètre `variant` traduit (`variant.<variante>`).
 */
export function contextLine(game: RecentGame, family: GameFamily): I18nLine {
  if (game.context === 'machine') return { key: 'recent.ctxMachine' };
  if (game.context === 'league') return { key: 'recent.ctxLeague' };
  if (game.stake > 0) {
    return family === 'ludo'
      ? { key: 'recent.ctxPot', params: { count: game.playerCount, pot: game.stake * game.playerCount } }
      : { key: 'recent.ctxStake', params: { stake: game.stake } };
  }
  return family === 'ludo' ? { key: 'recent.ctxPlayers', params: { count: game.playerCount } } : { key: 'recent.ctxRoom' };
}

/** Points montrés à droite : cauris si la partie en a fait bouger, sinon la force (partie classée). */
export function pointsOf(game: RecentGame): { kind: 'cauris' | 'rating'; value: number } | null {
  if (game.cauris !== null && game.cauris !== 0) return { kind: 'cauris', value: game.cauris };
  if (game.ratingDelta !== null) return { kind: 'rating', value: game.ratingDelta };
  return null;
}

export function pointsTone(value: number): ResultTone {
  return value > 0 ? 'gain' : value < 0 ? 'alert' : 'muted';
}

/** La vitrine est vide : aucune partie terminée dans ce jeu (Matrice : « Joue ta première partie »). */
export function isEmptyShowcase(family: FamilyProfile): boolean {
  return family.recent.length === 0 && family.record.wins + family.record.draws + family.record.losses === 0;
}
