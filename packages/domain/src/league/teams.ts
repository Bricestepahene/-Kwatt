/**
 * Matchs par équipes (planche RegleCompet, « Matchs par équipes »).
 *
 * Dames, équipes de 3 : une rencontre = 3 parties en même temps. Le capitaine
 * dépose l'ordre de ses joueurs 1 h avant ; personne ne voit celui de l'autre.
 * L'équipe qui reçoit a les blancs sur les planches 1 et 3. Partie gagnée
 * 2 pts, nulle 1. Rencontre gagnée 3 pts de ligue, nulle 1.
 *
 * Ludo, équipes de 2 : partenaires face à face ; l'équipe marque la somme des
 * places de ses deux joueurs (la plus petite somme gagne).
 */

export const DAMES_TEAM_SIZE = 3;
export const TEAM_GAME_WIN = 2;
export const TEAM_GAME_DRAW = 1;
export const TEAM_MATCH_WIN = 3;
export const TEAM_MATCH_DRAW = 1;
/** Dépôt de l'ordre des joueurs : au plus tard 1 h avant la rencontre. */
export const LINEUP_DEADLINE_MS = 3_600_000;

/** Couleur de l'équipe qui reçoit sur une planche (1 à 3). */
export function homeColorOnBoard(board: number): 'w' | 'b' {
  if (!Number.isInteger(board) || board < 1 || board > DAMES_TEAM_SIZE) throw new Error('Planche invalide');
  return board % 2 === 1 ? 'w' : 'b';
}

export type BoardResult = 'home' | 'away' | 'draw';

export interface TeamMatchScore {
  /** Points de parties (sur 6). */
  homeGamePoints: number;
  awayGamePoints: number;
  winner: 'home' | 'away' | null;
  homeLeaguePoints: number;
  awayLeaguePoints: number;
}

export function damesTeamMatch(boards: readonly BoardResult[]): TeamMatchScore {
  if (boards.length !== DAMES_TEAM_SIZE) throw new Error('Une rencontre se joue sur 3 planches');
  let home = 0;
  let away = 0;
  for (const b of boards) {
    if (b === 'home') home += TEAM_GAME_WIN;
    else if (b === 'away') away += TEAM_GAME_WIN;
    else {
      home += TEAM_GAME_DRAW;
      away += TEAM_GAME_DRAW;
    }
  }
  const winner = home > away ? 'home' : away > home ? 'away' : null;
  return {
    homeGamePoints: home,
    awayGamePoints: away,
    winner,
    homeLeaguePoints: winner === 'home' ? TEAM_MATCH_WIN : winner === null ? TEAM_MATCH_DRAW : 0,
    awayLeaguePoints: winner === 'away' ? TEAM_MATCH_WIN : winner === null ? TEAM_MATCH_DRAW : 0,
  };
}

/**
 * Ordre des joueurs : déposé au plus tard 1 h avant la rencontre, et figé à
 * ce moment-là. « Personne ne voit celui de l'autre avant » : il devient
 * visible pour l'adversaire à l'heure limite seulement (même si les deux
 * capitaines l'ont déposé plus tôt, chacun peut encore le changer).
 */
export function lineupDeadline(matchAt: number): number {
  return matchAt - LINEUP_DEADLINE_MS;
}

export function lineupVisible(input: { now: number; matchAt: number }): boolean {
  return input.now >= lineupDeadline(input.matchAt);
}

/** Un capitaine peut-il encore déposer ou changer son ordre ? */
export function lineupEditable(input: { now: number; matchAt: number }): boolean {
  return input.now < lineupDeadline(input.matchAt);
}

/**
 * Ordre d'une équipe à l'heure limite : celui déposé, sinon l'ordre de
 * l'effectif (décision : pas de forfait d'équipe pour un ordre oublié).
 */
export function effectiveLineup(submitted: readonly string[] | null, roster: readonly string[]): string[] {
  const order = submitted ?? roster.slice(0, DAMES_TEAM_SIZE);
  if (order.length !== DAMES_TEAM_SIZE) throw new Error('Une équipe aligne 3 joueurs');
  if (new Set(order).size !== order.length) throw new Error('Joueur aligné deux fois');
  if (!order.every((p) => roster.includes(p))) throw new Error('Joueur hors effectif');
  return [...order];
}

/**
 * Planches d'une rencontre : le joueur n de chaque ordre joue la planche n ;
 * l'équipe qui reçoit a les blancs sur les planches 1 et 3.
 */
export function teamBoards(homeLineup: readonly string[], awayLineup: readonly string[]): { board: number; white: string; black: string }[] {
  if (homeLineup.length !== DAMES_TEAM_SIZE || awayLineup.length !== DAMES_TEAM_SIZE) throw new Error('Une équipe aligne 3 joueurs');
  return homeLineup.map((h, i) => {
    const a = awayLineup[i]!;
    const board = i + 1;
    return homeColorOnBoard(board) === 'w' ? { board, white: h, black: a } : { board, white: a, black: h };
  });
}

export interface LudoTeamScore {
  team: string;
  /** Somme des places des deux partenaires. */
  placeSum: number;
  /** Meilleure place de l'équipe (départage). */
  bestPlace: number;
  rank: number;
}

/**
 * Classement des équipes d'une table de Ludo : somme des places, la plus
 * petite gagne. À égalité, l'équipe du joueur le mieux placé passe devant.
 */
export function ludoTeamRanking(teams: Readonly<Record<string, readonly string[]>>, places: Readonly<Record<string, number>>): LudoTeamScore[] {
  const scores = Object.entries(teams).map(([team, members]) => {
    const ps = members.map((m) => {
      const p = places[m];
      if (p === undefined) throw new Error(`Place manquante : ${m}`);
      return p;
    });
    return { team, placeSum: ps.reduce((a, b) => a + b, 0), bestPlace: Math.min(...ps), rank: 0 };
  });
  scores.sort((a, b) => a.placeSum - b.placeSum || a.bestPlace - b.bestPlace);
  scores.forEach((s, i) => (s.rank = i + 1));
  return scores;
}
