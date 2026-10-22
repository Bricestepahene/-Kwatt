/**
 * Ludo en ligue (planche RegleCompet, « Ludo en ligue : composer les tables »).
 *
 * - Tables de 4 (ou de 6 en variante 6 joueurs). Points : 4 au 1er, 2 au 2e,
 *   1 au 3e, 0 au 4e. Table de 3 : 4, 2, 0.
 * - Si le nombre de joueurs ne tombe pas juste, on ajoute des tables plus
 *   petites : 14 joueurs = 2 tables de 4 et 2 tables de 3. On répartit les
 *   joueurs le plus également possible en ⌈n ÷ taille⌉ tables.
 * - À chaque journée, les tables sont recomposées pour que deux joueurs se
 *   croisent le moins souvent possible : on compte les rencontres passées de
 *   chaque paire et on choisit la répartition au total le plus bas.
 * - Un joueur exclu laisse sa place libre : la table joue à 3 ce jour-là.
 */
import { rankRows, type Ranking, type RankingOptions, type StandingRow } from './standings.js';

/**
 * Points par place selon la taille de la table : 1er 4, 2e 2, dernier 0,
 * les places intermédiaires 1 (4 → 4/2/1/0, 3 → 4/2/0, 6 → 4/2/1/1/1/0).
 */
export function ludoTablePoints(tableSize: number): number[] {
  if (!Number.isInteger(tableSize) || tableSize < 2) throw new Error('Table trop petite');
  if (tableSize === 2) return [4, 0];
  return Array.from({ length: tableSize }, (_, i) => (i === 0 ? 4 : i === 1 ? 2 : i === tableSize - 1 ? 0 : 1));
}

/** Tailles des tables pour n joueurs : ⌈n ÷ max⌉ tables, réparties au plus juste. */
export function ludoTableSizes(players: number, maxSize: 4 | 6 = 4): number[] {
  if (players < 2) throw new Error('Il faut au moins deux joueurs');
  const tables = Math.ceil(players / maxSize);
  const base = Math.floor(players / tables);
  const extra = players % tables;
  return Array.from({ length: tables }, (_, i) => base + (i < extra ? 1 : 0));
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Compte les rencontres passées de chaque paire à partir des tables déjà jouées. */
export function meetingCounts(pastTables: readonly (readonly string[])[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of pastTables) {
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) {
        const k = pairKey(t[i]!, t[j]!);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Coût d'une répartition : somme des rencontres passées des paires réunies. */
export function compositionCost(tables: readonly (readonly string[])[], meetings: ReadonlyMap<string, number>): number {
  let cost = 0;
  for (const t of tables) {
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) cost += meetings.get(pairKey(t[i]!, t[j]!)) ?? 0;
    }
  }
  return cost;
}

/** Petit générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ComposeOptions {
  maxSize?: 4 | 6;
  /** Graine (issue du tirage vérifiable de la journée) : même graine, mêmes tables. */
  seed?: number;
  /** Nombre de départs de la recherche locale. */
  restarts?: number;
}

/**
 * Compose les tables d'une journée en minimisant les rencontres répétées.
 * Recherche locale déterministe (échanges de joueurs entre tables) depuis
 * plusieurs départs ; renvoie la meilleure répartition trouvée.
 */
export function composeLudoTables(
  players: readonly string[],
  meetings: ReadonlyMap<string, number>,
  options: ComposeOptions = {},
): { tables: string[][]; cost: number } {
  const sizes = ludoTableSizes(players.length, options.maxSize ?? 4);
  const random = rng(options.seed ?? 1);
  const restarts = options.restarts ?? 12;
  const sorted = [...players].sort();
  let best: { tables: string[][]; cost: number } | null = null;

  for (let r = 0; r < restarts; r++) {
    // Départ : mélange de Fisher-Yates (le premier départ garde l'ordre trié).
    const order = [...sorted];
    if (r > 0) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
    }
    const tables: string[][] = [];
    let k = 0;
    for (const s of sizes) {
      tables.push(order.slice(k, k + s));
      k += s;
    }
    // Recherche locale : on accepte tout échange qui baisse le coût, jusqu'à stabilité.
    const tableCost = (t: readonly string[]): number => compositionCost([t], meetings);
    let improved = true;
    while (improved) {
      improved = false;
      for (let a = 0; a < tables.length; a++) {
        for (let b = a + 1; b < tables.length; b++) {
          const ta = tables[a]!;
          const tb = tables[b]!;
          for (let i = 0; i < ta.length; i++) {
            for (let j = 0; j < tb.length; j++) {
              const before = tableCost(ta) + tableCost(tb);
              [ta[i], tb[j]] = [tb[j]!, ta[i]!];
              const after = tableCost(ta) + tableCost(tb);
              if (after < before) improved = true;
              else [ta[i], tb[j]] = [tb[j]!, ta[i]!];
            }
          }
        }
      }
    }
    const cost = compositionCost(tables, meetings);
    if (!best || cost < best.cost) best = { tables: tables.map((t) => [...t].sort()), cost };
    if (best.cost === 0) break;
  }
  return best!;
}

export interface LudoTableResult {
  round: number;
  /** Joueurs de la table avec leur place (1 = premier) et leurs pions rentrés. */
  seats: { playerId: string; place: number; tokensHome: number }[];
}

/** Points de chaque joueur à une table (la taille de la table = nombre de joueurs présents). */
export function ludoTableScores(table: LudoTableResult): Map<string, number> {
  const pts = ludoTablePoints(table.seats.length);
  return new Map(table.seats.map((s) => [s.playerId, pts[s.place - 1] ?? 0]));
}

/**
 * Classement d'une ligue de Ludo : points de table ; départage par
 * confrontation directe (fois où l'un a fini devant l'autre à la même table),
 * nombre de victoires (1res places), pions rentrés, puis tirage.
 */
export function ludoStandings(players: readonly string[], tables: readonly LudoTableResult[], options: RankingOptions = {}): Ranking {
  const rows = new Map<string, Omit<StandingRow, 'position'>>(
    players.map((p) => [p, { playerId: p, played: 0, wins: 0, draws: 0, losses: 0, forfeits: 0, penalties: 0, points: 0, tiebreakValue: 0 }]),
  );
  for (const t of tables) {
    const scores = ludoTableScores(t);
    for (const s of t.seats) {
      const r = rows.get(s.playerId);
      if (!r) continue;
      r.played++;
      r.points += scores.get(s.playerId) ?? 0;
      if (s.place === 1) r.wins++;
      else r.losses++;
      r.tiebreakValue += s.tokensHome;
    }
  }
  return rankRows(
    {
      rows: [...rows.values()],
      headToHead(group) {
        const inGroup = new Set(group);
        const score = new Map<string, number>(group.map((id) => [id, 0]));
        for (const t of tables) {
          const here = t.seats.filter((s) => inGroup.has(s.playerId));
          for (const a of here) for (const b of here) if (a.place < b.place) score.set(a.playerId, score.get(a.playerId)! + 1);
        }
        return score;
      },
    },
    options,
  );
}
