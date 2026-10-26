/**
 * Force façon Elo, par variante classée (SPEC §7).
 *
 * - Départ à 900.
 * - K = 32 pendant les 30 premières parties de la variante, puis 20. Chaque
 *   joueur a son propre K : la somme des variations n'est donc pas toujours nulle.
 * - Ludo à n joueurs : chaque joueur fait un duel virtuel contre chacun des
 *   autres selon les places (mieux placé = victoire, même place = nulle), avec
 *   K ÷ (n − 1) par duel.
 * - Les forces sont des entiers : la variation est arrondie à l'entier le plus
 *   proche une seule fois, à la fin du calcul.
 */

export const START_RATING = 900;
export const K_PROVISIONAL = 32;
export const K_ESTABLISHED = 20;
/** Nombre de parties jouées avec K = 32 avant de passer à 20. */
export const PROVISIONAL_GAMES = 30;

/** Variantes qui ont une force (planche RegleCompet, « Classement »). */
export const RATED_VARIANTS = ['dames10', 'dames8', 'ludo_classique', 'ludo_rapide', 'ludo_six'] as const;
export type RatedVariant = (typeof RATED_VARIANTS)[number];

export function isRatedVariant(variant: string): variant is RatedVariant {
  return (RATED_VARIANTS as readonly string[]).includes(variant);
}

/**
 * Chances de gagner : p = 1 / (1 + 10^((force adverse − ta force) / 400)).
 * C'est aussi le score attendu d'un duel Elo.
 */
export function winProbability(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** K selon le nombre de parties déjà jouées dans la variante. */
export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
}

export interface RatedPlayer {
  rating: number;
  /** Parties classées déjà jouées dans la variante, avant celle-ci. */
  gamesPlayed: number;
}

/** 1 = victoire, 0,5 = nulle, 0 = défaite. */
export type DuelScore = 1 | 0.5 | 0;

export interface RatingChange {
  before: number;
  after: number;
  delta: number;
}

function change(before: number, rawDelta: number): RatingChange {
  // Math.round(-0.4) donne -0 : on normalise pour des comparaisons simples.
  const delta = Math.round(rawDelta) || 0;
  return { before, after: before + delta, delta };
}

/** Variation d'un joueur après un duel (1 contre 1). */
export function duelChange(player: RatedPlayer, opponent: RatedPlayer, score: DuelScore): RatingChange {
  const expected = winProbability(player.rating, opponent.rating);
  return change(player.rating, kFactor(player.gamesPlayed) * (score - expected));
}

/** Duel complet : les deux variations. */
export function rateDuel(a: RatedPlayer, b: RatedPlayer, scoreA: DuelScore): { a: RatingChange; b: RatingChange } {
  const scoreB = (1 - scoreA) as DuelScore;
  return { a: duelChange(a, b, scoreA), b: duelChange(b, a, scoreB) };
}

export interface PlacedPlayer extends RatedPlayer {
  /** Place à l'arrivée : 1 = premier. Deux joueurs peuvent partager une place. */
  place: number;
}

/**
 * Partie à n joueurs (Ludo) : duels deux à deux selon les places, K ÷ (n − 1).
 * Renvoie les variations dans l'ordre des joueurs reçus.
 */
export function rateMultiplayer(players: readonly PlacedPlayer[]): RatingChange[] {
  const n = players.length;
  if (n < 2) throw new Error('Il faut au moins deux joueurs');
  return players.map((p, i) => {
    const k = kFactor(p.gamesPlayed) / (n - 1);
    let raw = 0;
    players.forEach((o, j) => {
      if (i === j) return;
      const score = p.place < o.place ? 1 : p.place === o.place ? 0.5 : 0;
      raw += k * (score - winProbability(p.rating, o.rating));
    });
    return change(p.rating, raw);
  });
}
