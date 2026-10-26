/**
 * Classement des ligues de Dames (1 contre 1) et départage
 * (planches RegleLigues et RegleCompet).
 *
 * Points : victoire 3, nulle 1, défaite 0 (V 3 · N 1 · D 0, écran 28).
 * Forfait : l'adversaire marque 3 pts, l'absent 0 pt et −1 pt de pénalité.
 * Double forfait : « 0 pt et amende pour chacun » (planche RegleLigues, à la
 * lettre) : pas de point de pénalité, mais chacun compte un forfait (amende,
 * exclusion).
 * Un forfait et une victoire attribuée à la suite d'une exclusion comptent
 * 1–0 pour la différence de pions.
 *
 * Départage : 1 points, 2 confrontation directe (mini-classement entre les
 * joueurs à égalité, réappliqué tant qu'il sépare), 3 nombre de victoires,
 * 4 différence de pions (Dames) ou pions rentrés (Ludo), 5 tirage au sort
 * vérifiable (ordre fourni en paramètre). Pour une place qualificative, une
 * manche décisive de 5 minutes remplace le tirage au sort.
 */

export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;
export const POINTS_LOSS = 0;
export const FORFEIT_PENALTY = 1;
/** Double forfait : 0 pt, sans pénalité (planche RegleLigues). */
export const DOUBLE_FORFEIT_PENALTY = 0;
/** Différence de pions comptée pour un forfait ou une victoire attribuée (1–0). */
export const DEFAULT_WIN_MARGIN = 1;

export type MatchOutcome =
  | 'home_win'
  | 'away_win'
  | 'draw'
  /** L'équipe ou le joueur à domicile était absent : victoire de l'extérieur par forfait. */
  | 'home_forfeit'
  | 'away_forfeit'
  | 'double_forfeit'
  /** Victoire 1–0 attribuée (adversaire exclu après avoir joué la moitié de ses matchs ou plus). */
  | 'home_awarded'
  | 'away_awarded';

export interface MatchRecord {
  round: number;
  home: string;
  away: string;
  outcome: MatchOutcome;
  /** Pièces restantes de home − pièces restantes de away, en fin de partie jouée. */
  pieceDiff?: number;
}

export function isForfeit(outcome: MatchOutcome): boolean {
  return outcome === 'home_forfeit' || outcome === 'away_forfeit' || outcome === 'double_forfeit';
}

export function forfeitedBy(m: MatchRecord): string[] {
  if (m.outcome === 'home_forfeit') return [m.home];
  if (m.outcome === 'away_forfeit') return [m.away];
  if (m.outcome === 'double_forfeit') return [m.home, m.away];
  return [];
}

interface Side {
  points: number;
  penalty: number;
  win: boolean;
  draw: boolean;
  loss: boolean;
  forfeit: boolean;
  diff: number;
}

/** Ce que rapporte une rencontre à chacun des deux joueurs. */
export function matchPoints(m: MatchRecord): { home: Side; away: Side } {
  const diff = m.pieceDiff ?? 0;
  const side = (points: number, kind: 'win' | 'draw' | 'loss', forfeit: boolean, d: number, penalty = 0): Side => ({
    points,
    penalty,
    win: kind === 'win',
    draw: kind === 'draw',
    loss: kind === 'loss',
    forfeit,
    diff: d,
  });
  switch (m.outcome) {
    case 'home_win':
      return { home: side(POINTS_WIN, 'win', false, diff), away: side(POINTS_LOSS, 'loss', false, -diff) };
    case 'away_win':
      return { home: side(POINTS_LOSS, 'loss', false, diff), away: side(POINTS_WIN, 'win', false, -diff) };
    case 'draw':
      return { home: side(POINTS_DRAW, 'draw', false, diff), away: side(POINTS_DRAW, 'draw', false, -diff) };
    case 'home_forfeit':
      return {
        home: side(POINTS_LOSS, 'loss', true, -DEFAULT_WIN_MARGIN, FORFEIT_PENALTY),
        away: side(POINTS_WIN, 'win', false, DEFAULT_WIN_MARGIN),
      };
    case 'away_forfeit':
      return {
        home: side(POINTS_WIN, 'win', false, DEFAULT_WIN_MARGIN),
        away: side(POINTS_LOSS, 'loss', true, -DEFAULT_WIN_MARGIN, FORFEIT_PENALTY),
      };
    case 'double_forfeit':
      return {
        home: side(POINTS_LOSS, 'loss', true, 0, DOUBLE_FORFEIT_PENALTY),
        away: side(POINTS_LOSS, 'loss', true, 0, DOUBLE_FORFEIT_PENALTY),
      };
    case 'home_awarded':
      return { home: side(POINTS_WIN, 'win', false, DEFAULT_WIN_MARGIN), away: side(POINTS_LOSS, 'loss', false, -DEFAULT_WIN_MARGIN) };
    case 'away_awarded':
      return { home: side(POINTS_LOSS, 'loss', false, -DEFAULT_WIN_MARGIN), away: side(POINTS_WIN, 'win', false, DEFAULT_WIN_MARGIN) };
  }
}

export interface StandingRow {
  playerId: string;
  /** Place (1 = premier). */
  position: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  forfeits: number;
  /** Points de pénalité (positifs, déjà retranchés de `points`). */
  penalties: number;
  points: number;
  /** Dames : différence de pions ; Ludo : pions rentrés. */
  tiebreakValue: number;
}

export interface RankingOptions {
  /** Ordre issu du tirage au sort vérifiable (critère 5). */
  draw?: readonly string[];
  /** Nombre de places qualificatives (coupe, podium…). */
  qualifyingPlaces?: number;
  /** Ordre issu des manches décisives déjà jouées. */
  playoffOrder?: readonly string[];
}

export interface Ranking {
  rows: StandingRow[];
  /** Égalités qui n'ont été tranchées par aucun critère sportif (critère 5 nécessaire). */
  drawNeeded: string[][];
  /** Égalités à cheval sur une place qualificative : manche décisive de 5 minutes. */
  playoffNeeded: string[][];
}

/** Ce dont le départage a besoin, indépendamment du jeu. */
export interface TiebreakSource {
  rows: Omit<StandingRow, 'position'>[];
  /** Points de confrontation directe entre les joueurs d'un groupe. */
  headToHead(group: readonly string[]): Map<string, number>;
}

/** Classe les lignes selon les 5 critères. */
export function rankRows(source: TiebreakSource, options: RankingOptions = {}): Ranking {
  const byId = new Map(source.rows.map((r) => [r.playerId, r]));
  const drawNeeded: string[][] = [];
  const playoffNeeded: string[][] = [];

  const partition = (ids: string[], key: (id: string) => number): string[][] => {
    const groups = new Map<number, string[]>();
    for (const id of ids) {
      const k = key(id);
      const g = groups.get(k) ?? [];
      g.push(id);
      groups.set(k, g);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, g]) => g);
  };

  // Critères sportifs après les points : 2 confrontation directe, 3 victoires,
  // 4 différence de pions (Dames) ou pions rentrés (Ludo).
  const criterion = (c: number, ids: readonly string[]): ((id: string) => number) => {
    if (c === 0) {
      const h2h = source.headToHead(ids);
      return (id) => h2h.get(id) ?? 0;
    }
    if (c === 1) return (id) => byId.get(id)!.wins;
    return (id) => byId.get(id)!.tiebreakValue;
  };

  // Dès qu'un critère sépare le groupe, chaque sous-groupe encore à égalité
  // repart du critère 2 (la confrontation directe entre eux seuls). Les
  // sous-groupes sont strictement plus petits : la récursion se termine.
  const resolve = (ids: string[]): string[][] => {
    if (ids.length < 2) return [ids];
    for (let c = 0; c < 3; c++) {
      const parts = partition(ids, criterion(c, ids));
      if (parts.length > 1) return parts.flatMap((p) => resolve(p));
    }
    return [ids];
  };

  const ordered: string[][] = [];
  for (const g of partition([...byId.keys()].sort(), (id) => byId.get(id)!.points)) ordered.push(...resolve(g));

  const rank = (list: readonly string[] | undefined, id: string): number => {
    const i = list ? list.indexOf(id) : -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };

  const rows: StandingRow[] = [];
  let position = 1;
  for (const group of ordered) {
    if (group.length > 1) {
      const start = position;
      const end = position + group.length - 1;
      const q = options.qualifyingPlaces;
      const straddles = q !== undefined && start <= q && end > q;
      if (straddles) {
        const decided = options.playoffOrder && group.every((id) => options.playoffOrder!.includes(id));
        if (!decided) playoffNeeded.push([...group]);
        group.sort((a, b) => rank(options.playoffOrder, a) - rank(options.playoffOrder, b) || rank(options.draw, a) - rank(options.draw, b) || (a < b ? -1 : 1));
      } else {
        const decided = options.draw && group.every((id) => options.draw!.includes(id));
        if (!decided) drawNeeded.push([...group]);
        group.sort((a, b) => rank(options.draw, a) - rank(options.draw, b) || (a < b ? -1 : 1));
      }
    }
    for (const id of group) rows.push({ ...byId.get(id)!, position: position++ });
  }
  return { rows, drawNeeded, playoffNeeded };
}

/** Lignes de classement d'une ligue de Dames à partir des rencontres jouées. */
export function damesRows(players: readonly string[], matches: readonly MatchRecord[]): Omit<StandingRow, 'position'>[] {
  const rows = new Map<string, Omit<StandingRow, 'position'>>(
    players.map((p) => [p, { playerId: p, played: 0, wins: 0, draws: 0, losses: 0, forfeits: 0, penalties: 0, points: 0, tiebreakValue: 0 }]),
  );
  for (const m of matches) {
    const pts = matchPoints(m);
    for (const [id, s] of [
      [m.home, pts.home],
      [m.away, pts.away],
    ] as const) {
      const r = rows.get(id);
      if (!r) continue;
      r.played++;
      if (s.win) r.wins++;
      if (s.draw) r.draws++;
      if (s.loss) r.losses++;
      if (s.forfeit) r.forfeits++;
      r.penalties += s.penalty;
      r.points += s.points - s.penalty;
      r.tiebreakValue += s.diff;
    }
  }
  return [...rows.values()];
}

/** Classement complet d'une ligue de Dames. */
export function damesStandings(players: readonly string[], matches: readonly MatchRecord[], options: RankingOptions = {}): Ranking {
  return rankRows(
    {
      rows: damesRows(players, matches),
      headToHead(group) {
        const inGroup = new Set(group);
        const score = new Map<string, number>(group.map((id) => [id, 0]));
        for (const m of matches) {
          if (!inGroup.has(m.home) || !inGroup.has(m.away)) continue;
          const pts = matchPoints(m);
          score.set(m.home, score.get(m.home)! + pts.home.points - pts.home.penalty);
          score.set(m.away, score.get(m.away)! + pts.away.points - pts.away.penalty);
        }
        return score;
      },
    },
    options,
  );
}
