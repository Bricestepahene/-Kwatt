/**
 * Calendrier des ligues (planche RegleLigues, « Le calendrier »).
 *
 * - Méthode du cercle : n joueurs (n pair) = n − 1 journées de n ÷ 2 matchs ;
 *   n impair : on ajoute une place « exempt », chacun se repose une journée.
 *   14 joueurs = 13 journées, 7 matchs par jour, 91 matchs.
 * - Aller-retour : la phase retour répète la phase aller, domicile inversé.
 * - L'ordre des joueurs reçu est celui du tirage au sort (fait ailleurs, par
 *   le tirage vérifiable) : ce module est déterministe.
 * - Recomposition après exclusion :
 *   · un exclu : on garde la table de rencontres ; sa place devient
 *     « exempt », son adversaire du jour se repose, aucun autre match ne bouge ;
 *   · deux exclus ou plus : on garde les rencontres non jouées entre joueurs
 *     encore là et on les range jour par jour, chacun jouant au plus une fois
 *     par jour, en un minimum de journées :
 *     journées min. = max(⌈matchs restants ÷ ⌊n ÷ 2⌋⌉, matchs restants du joueur le plus en retard).
 */

export interface Fixture {
  /** Journée, à partir de 1. */
  round: number;
  home: string;
  away: string;
}

export interface Round {
  round: number;
  matches: Fixture[];
  /** Joueurs qui se reposent ce jour-là (exempt). */
  byes: string[];
}

export interface RoundRobinOptions {
  /** Aller-retour (championnat privé) ; aller simple par défaut (ligue publique). */
  doubleRound?: boolean;
}

/** Calendrier complet par la méthode du cercle. */
export function roundRobin(players: readonly string[], options: RoundRobinOptions = {}): Round[] {
  if (new Set(players).size !== players.length) throw new Error('Joueur en double');
  if (players.length < 2) throw new Error('Il faut au moins deux joueurs');
  const slots: (string | null)[] = [...players];
  if (slots.length % 2 === 1) slots.push(null);
  const m = slots.length;
  const rounds: Round[] = [];
  const arr = [...slots];
  for (let r = 0; r < m - 1; r++) {
    const matches: Fixture[] = [];
    const byes: string[] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i]!;
      const b = arr[m - 1 - i]!;
      if (a === null || b === null) {
        const resting = a ?? b;
        if (resting !== null) byes.push(resting);
        continue;
      }
      // Le joueur fixe alterne domicile et extérieur ; les autres paires suivent la rotation.
      const swap = i === 0 ? r % 2 === 1 : false;
      matches.push({ round: r + 1, home: swap ? b : a, away: swap ? a : b });
    }
    rounds.push({ round: r + 1, matches, byes });
    // Rotation : le premier reste fixe, les autres tournent d'un cran.
    const last = arr.pop()!;
    arr.splice(1, 0, last);
  }
  if (options.doubleRound) {
    const first = rounds.length;
    for (const r of rounds.slice(0, first)) {
      rounds.push({
        round: r.round + first,
        matches: r.matches.map((f) => ({ round: f.round + first, home: f.away, away: f.home })),
        byes: [...r.byes],
      });
    }
  }
  return rounds;
}

/** Nombre de matchs d'un tous-contre-tous : C(n, 2), doublé en aller-retour. */
export function roundRobinMatchCount(players: number, doubleRound = false): number {
  return ((players * (players - 1)) / 2) * (doubleRound ? 2 : 1);
}

/** Nombre de journées : n − 1 (n pair) ou n (n impair), doublé en aller-retour. */
export function roundRobinRoundCount(players: number, doubleRound = false): number {
  return (players % 2 === 0 ? players - 1 : players) * (doubleRound ? 2 : 1);
}

/** Matchs prévus pour un joueur dans tout le calendrier. */
export function matchesPerPlayer(players: number, doubleRound = false): number {
  return (players - 1) * (doubleRound ? 2 : 1);
}

/** Regroupe des rencontres par journée (les journées vides sont gardées). */
export function groupByRound(fixtures: readonly Fixture[], players: readonly string[]): Round[] {
  if (fixtures.length === 0) return [];
  const first = Math.min(...fixtures.map((f) => f.round));
  const last = Math.max(...fixtures.map((f) => f.round));
  const rounds: Round[] = [];
  for (let r = first; r <= last; r++) {
    const matches = fixtures.filter((f) => f.round === r);
    const busy = new Set(matches.flatMap((f) => [f.home, f.away]));
    rounds.push({ round: r, matches, byes: players.filter((p) => !busy.has(p)) });
  }
  return rounds;
}

/**
 * Un seul exclu : la table de rencontres ne bouge pas, ses matchs à venir
 * disparaissent et son adversaire du jour se repose.
 */
export function withExcludedAsBye(unplayed: readonly Fixture[], excluded: string): { fixtures: Fixture[]; rested: { round: number; player: string }[] } {
  const fixtures: Fixture[] = [];
  const rested: { round: number; player: string }[] = [];
  for (const f of unplayed) {
    if (f.home === excluded) rested.push({ round: f.round, player: f.away });
    else if (f.away === excluded) rested.push({ round: f.round, player: f.home });
    else fixtures.push({ ...f });
  }
  return { fixtures, rested };
}

/** Borne basse du nombre de journées pour ranger des rencontres (planche RegleLigues). */
export function minimumRounds(pairs: readonly Pick<Fixture, 'home' | 'away'>[], playerCount: number): number {
  if (pairs.length === 0) return 0;
  const perDay = Math.floor(playerCount / 2);
  if (perDay === 0) throw new Error('Pas assez de joueurs');
  const load = new Map<string, number>();
  for (const p of pairs) {
    load.set(p.home, (load.get(p.home) ?? 0) + 1);
    load.set(p.away, (load.get(p.away) ?? 0) + 1);
  }
  return Math.max(Math.ceil(pairs.length / perDay), ...load.values());
}

interface Edge {
  id: number;
  home: string;
  away: string;
}

/** Limite de recherche : au-delà, on accepte une journée de plus. */
const PACK_STEP_LIMIT = 200_000;

/**
 * Range des rencontres jour par jour (chacun joue au plus une fois par jour)
 * en un minimum de journées, à partir de la journée `firstRound`.
 * Déterministe : à entrées égales, même calendrier.
 */
export function packFixtures(
  pairs: readonly Pick<Fixture, 'home' | 'away'>[],
  players: readonly string[],
  firstRound: number,
): Fixture[] {
  if (pairs.length === 0) return [];
  const edges: Edge[] = pairs.map((p, id) => ({ id, home: p.home, away: p.away }));
  const perDay = Math.floor(players.length / 2);
  const lower = minimumRounds(pairs, players.length);
  for (let days = lower; days <= edges.length; days++) {
    const steps = { left: PACK_STEP_LIMIT };
    const plan = packInto(edges, days, perDay, steps);
    if (plan) {
      return plan.flatMap((day, i) =>
        day.map((e) => ({ round: firstRound + i, home: e.home, away: e.away })),
      );
    }
  }
  throw new Error('Rangement impossible');
}

function packInto(edges: Edge[], days: number, perDay: number, steps: { left: number }): Edge[][] | null {
  if (edges.length === 0) return Array.from({ length: days }, () => []);
  if (days === 0) return null;
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.home, (degree.get(e.home) ?? 0) + 1);
    degree.set(e.away, (degree.get(e.away) ?? 0) + 1);
  }
  // Un joueur qui a plus de matchs que de journées restantes : impossible.
  for (const d of degree.values()) if (d > days) return null;
  if (edges.length > days * perDay) return null;
  // Joueurs « critiques » : autant de matchs que de journées, ils jouent aujourd'hui.
  const critical = new Set([...degree].filter(([, d]) => d === days).map(([p]) => p));
  const minToday = edges.length - (days - 1) * perDay;
  const order = [...degree.keys()].sort((a, b) => {
    const ca = critical.has(a) ? 1 : 0;
    const cb = critical.has(b) ? 1 : 0;
    if (ca !== cb) return cb - ca;
    const d = degree.get(b)! - degree.get(a)!;
    return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
  });
  const incident = new Map<string, Edge[]>();
  for (const e of edges) {
    for (const p of [e.home, e.away]) {
      const list = incident.get(p) ?? [];
      list.push(e);
      incident.set(p, list);
    }
  }
  const other = (e: Edge, p: string): string => (e.home === p ? e.away : e.home);

  const used = new Set<string>();
  const chosen: Edge[] = [];

  const rec = (i: number): Edge[][] | null => {
    if (--steps.left < 0) return null;
    // Borne : même en appariant tous les joueurs restants, pas assez de matchs.
    let free = 0;
    for (let j = i; j < order.length; j++) if (!used.has(order[j]!)) free++;
    if (chosen.length + Math.floor(free / 2) < minToday) return null;
    if (i === order.length) {
      const today = new Set(chosen.map((e) => e.id));
      const rest = edges.filter((e) => !today.has(e.id));
      const tail = packInto(rest, days - 1, perDay, steps);
      return tail ? [[...chosen], ...tail] : null;
    }
    const p = order[i]!;
    if (used.has(p)) return rec(i + 1);
    const options = (incident.get(p) ?? [])
      .filter((e) => !used.has(other(e, p)))
      .sort((x, y) => {
        const dx = degree.get(other(x, p))!;
        const dy = degree.get(other(y, p))!;
        if (dx !== dy) return dy - dx;
        return x.id - y.id;
      });
    const seen = new Set<string>();
    for (const e of options) {
      const q = other(e, p);
      // Deux rencontres entre les mêmes joueurs (aller-retour) : une seule essayée par jour.
      if (seen.has(q)) continue;
      seen.add(q);
      used.add(p);
      used.add(q);
      chosen.push(e);
      const res = rec(i + 1);
      chosen.pop();
      used.delete(p);
      used.delete(q);
      if (res) return res;
      if (steps.left < 0) return null;
    }
    if (!critical.has(p)) return rec(i + 1);
    return null;
  };
  return rec(0);
}

export interface Recomposition {
  mode: 'bye' | 'repacked';
  fixtures: Fixture[];
  /** Mode « bye » : qui se repose à la place d'un match contre l'exclu. */
  rested: { round: number; player: string }[];
  /** Dernière journée du nouveau calendrier (null s'il ne reste rien). */
  lastRound: number | null;
}

/**
 * Recompose les rencontres non jouées après une ou plusieurs exclusions.
 * `unplayed` : rencontres encore à jouer, telles que prévues (journées
 * d'origine) ; `fromRound` : première journée disponible pour le rangement.
 */
export function recomposeAfterExclusions(input: {
  unplayed: readonly Fixture[];
  players: readonly string[];
  excluded: readonly string[];
  fromRound: number;
}): Recomposition {
  const excluded = new Set(input.excluded);
  if (excluded.size === 1) {
    const [only] = [...excluded];
    const { fixtures, rested } = withExcludedAsBye(input.unplayed, only!);
    const lastRound = input.unplayed.length ? Math.max(...input.unplayed.map((f) => f.round)) : null;
    return { mode: 'bye', fixtures, rested, lastRound };
  }
  const present = input.players.filter((p) => !excluded.has(p));
  const remaining = input.unplayed.filter((f) => !excluded.has(f.home) && !excluded.has(f.away));
  const fixtures = packFixtures(remaining, present, input.fromRound);
  const lastRound = fixtures.length ? Math.max(...fixtures.map((f) => f.round)) : null;
  return { mode: 'repacked', fixtures, rested: [], lastRound };
}
