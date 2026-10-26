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

/** Résultat d'une planche ; `void` : double forfait, personne ne marque. */
export type BoardResult = 'home' | 'away' | 'draw' | 'void';

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
  // Trois doubles forfaits : la rencontre ne rapporte rien à personne.
  if (boards.every((b) => b === 'void')) return { homeGamePoints: 0, awayGamePoints: 0, winner: null, homeLeaguePoints: 0, awayLeaguePoints: 0 };
  for (const b of boards) {
    if (b === 'home') home += TEAM_GAME_WIN;
    else if (b === 'away') away += TEAM_GAME_WIN;
    else if (b === 'draw') {
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

/**
 * Rencontre de Ludo entre deux équipes de 2 (une table de 4, partenaires face à face).
 * Une place manquante (absent) compte comme la dernière place de la table. La plus petite
 * somme gagne (départage : le mieux placé) ; pas de nul. Rencontre gagnée 3 pts de ligue.
 * Points de parties : pions rentrés par l'équipe (départage du classement).
 * Si personne n'est venu, la rencontre ne rapporte rien.
 */
export function ludoTeamMatch(input: {
  home: readonly (number | null)[];
  away: readonly (number | null)[];
  homeTokens: number;
  awayTokens: number;
  tableSize: number;
}): TeamMatchScore {
  const { home, away, homeTokens, awayTokens, tableSize } = input;
  const nobody = [...home, ...away].every((p) => p === null);
  if (nobody) return { homeGamePoints: 0, awayGamePoints: 0, winner: null, homeLeaguePoints: 0, awayLeaguePoints: 0 };
  const places: Record<string, number> = {};
  home.forEach((p, i) => (places[`h${i}`] = p ?? tableSize));
  away.forEach((p, i) => (places[`a${i}`] = p ?? tableSize));
  const ranking = ludoTeamRanking({ home: home.map((_, i) => `h${i}`), away: away.map((_, i) => `a${i}`) }, places);
  // Toute une équipe absente : l'autre gagne, même à égalité de places.
  const homeAbsent = home.every((p) => p === null);
  const awayAbsent = away.every((p) => p === null);
  const winner = homeAbsent ? 'away' : awayAbsent ? 'home' : (ranking[0]!.team as 'home' | 'away');
  return {
    homeGamePoints: homeTokens,
    awayGamePoints: awayTokens,
    winner,
    homeLeaguePoints: winner === 'home' ? TEAM_MATCH_WIN : 0,
    awayLeaguePoints: winner === 'away' ? TEAM_MATCH_WIN : 0,
  };
}

export interface TeamMatchRecord {
  round: number;
  home: string;
  away: string;
  score: TeamMatchScore;
}

export interface TeamStandingRow {
  team: string;
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  gamesFor: number;
  gamesAgainst: number;
}

/**
 * Classement des équipes, avec le départage de la planche RegleCompet : 1 · points ;
 * 2 · confrontation directe (points de ligue entre les équipes à égalité) ; 3 · victoires ;
 * 4 · différence de points de parties (Dames) ou pions rentrés (Ludo) ; 5 · tirage au sort.
 */
export function teamStandings(teams: readonly string[], records: readonly TeamMatchRecord[], draw: readonly string[] = []): TeamStandingRow[] {
  const rows = new Map<string, TeamStandingRow>(
    teams.map((team) => [team, { team, position: 0, played: 0, wins: 0, draws: 0, losses: 0, points: 0, gamesFor: 0, gamesAgainst: 0 }]),
  );
  for (const r of records) {
    const s = r.score;
    const sides: [TeamStandingRow | undefined, number, number, number, 'home' | 'away'][] = [
      [rows.get(r.home), s.homeLeaguePoints, s.homeGamePoints, s.awayGamePoints, 'home'],
      [rows.get(r.away), s.awayLeaguePoints, s.awayGamePoints, s.homeGamePoints, 'away'],
    ];
    for (const [row, points, gf, ga, side] of sides) {
      if (!row) continue;
      row.played += 1;
      row.points += points;
      row.gamesFor += gf;
      row.gamesAgainst += ga;
      if (s.winner === side) row.wins += 1;
      else if (s.winner === null && points > 0) row.draws += 1;
      else row.losses += 1;
    }
  }
  const drawIndex = (t: string) => {
    const i = draw.indexOf(t);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  // Confrontation directe : points pris dans les rencontres entre équipes à égalité de points.
  const headToHead = new Map<string, number>();
  const byPoints = new Map<number, string[]>();
  for (const row of rows.values()) byPoints.set(row.points, [...(byPoints.get(row.points) ?? []), row.team]);
  for (const group of byPoints.values()) {
    if (group.length < 2) continue;
    for (const r of records) {
      if (!group.includes(r.home) || !group.includes(r.away)) continue;
      headToHead.set(r.home, (headToHead.get(r.home) ?? 0) + r.score.homeLeaguePoints);
      headToHead.set(r.away, (headToHead.get(r.away) ?? 0) + r.score.awayLeaguePoints);
    }
  }
  const h2h = (t: string) => headToHead.get(t) ?? 0;
  const sorted = [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      h2h(y.team) - h2h(x.team) ||
      y.wins - x.wins ||
      y.gamesFor - y.gamesAgainst - (x.gamesFor - x.gamesAgainst) ||
      drawIndex(x.team) - drawIndex(y.team),
  );
  sorted.forEach((r, i) => (r.position = i + 1));
  return sorted;
}

/**
 * Cagnotte d'une ligue privée par équipes : partagée à parts égales entre les joueurs de
 * l'équipe championne ; le reste de la division revient au capitaine.
 */
export function splitTeamPot(pot: number, members: readonly string[], captain: string): Record<string, number> {
  if (pot <= 0 || members.length === 0) return {};
  const each = Math.floor(pot / members.length);
  const out: Record<string, number> = {};
  for (const m of members) out[m] = each;
  out[captain] = (out[captain] ?? 0) + (pot - each * members.length);
  return out;
}
