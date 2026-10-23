/**
 * Calendrier des ligues : tirage au sort, journées, matchs à écrire en base.
 * Les règles (méthode du cercle, poules, tables de Ludo) viennent de @kwatt/domain.
 */
import { createHash } from 'node:crypto';
import {
  composeLudoTables,
  dayKey,
  makeGroups,
  matchInstant,
  meetingCounts,
  parseMatchTime,
  roundDay,
  roundRobin,
  roundRobinRoundCount,
  ludoTableSizes,
  type Fixture,
} from '@kwatt/domain';
import type { Sql } from '../../db/pool.js';
import type { LeagueRow, MatchStage } from './model.js';

/** Un match à écrire (sans date : elle vient de la journée). */
export interface PlannedMatch {
  stage: MatchStage;
  round: number;
  players: string[];
  group?: number | null;
  tie?: number | null;
  leg?: number | null;
  level?: number | null;
  /** Planche déjà connue (manche décisive : celle de l'aller). */
  board?: string | null;
}

/** Jour d'une journée : une par jour, ou une par semaine. */
export function dayOfRound(league: Pick<LeagueRow, 'first_day' | 'rhythm'>, round: number): string {
  return league.rhythm === 'weekly' ? roundDay(league.first_day, 7 * (round - 1) + 1) : roundDay(league.first_day, round);
}

export function matchAtOf(day: string, time: string): Date {
  return new Date(matchInstant(day, parseMatchTime(time)));
}

/**
 * Premier jour réel : le jour choisi, ou aujourd'hui s'il est passé, et le lendemain si le
 * match de la journée 1 tomberait dans moins de 2 heures.
 */
export function effectiveFirstDay(chosen: string, defaultTime: string, now: Date): string {
  const today = dayKey(now.getTime());
  let day = chosen > today ? chosen : today;
  if (matchAtOf(day, defaultTime).getTime() - now.getTime() < 2 * 3_600_000) day = roundDay(day, 2);
  return day;
}

/** Générateur déterministe (mulberry32) à partir de la graine du tirage. */
function seeded(seed: string): () => number {
  let a = createHash('sha256').update(seed).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tirage au sort : mélange de Fisher-Yates, reproductible avec la graine publiée. */
export function drawPlayers(players: readonly string[], seed: string): string[] {
  const rnd = seeded(seed);
  const out = [...players];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Graine numérique d'une journée (composition des tables de Ludo). */
export function roundSeed(seed: string, round: number): number {
  return createHash('sha256').update(`${seed}:${round}`).digest().readUInt32BE(0);
}

/** Taille des tables de Ludo : 6 si toutes les planches permises sont à 6, sinon 4. */
export function ludoTableSize(league: Pick<LeagueRow, 'board_rules'>): 4 | 6 {
  return league.board_rules.allowed.every((b) => b === 'ludo_six') ? 6 : 4;
}

/** Journées d'une ligue de Ludo : celles voulues, sinon une de moins que de joueurs. */
export function ludoRoundCount(league: Pick<LeagueRow, 'rounds'>, players: number): number {
  return league.rounds ?? Math.max(1, players - 1);
}

/** Championnat de Dames : méthode du cercle, aller simple ou aller-retour. */
export function championshipFixtures(order: readonly string[], doubleRound: boolean): PlannedMatch[] {
  return roundRobin(order, { doubleRound }).flatMap((r) => r.matches.map((f) => ({ stage: 'league' as const, round: f.round, players: [f.home, f.away] })));
}

/**
 * Ludo : tables recomposées à chaque journée pour que chacun croise tout le monde le plus
 * souvent possible (on compte les rencontres des journées précédentes).
 */
export function ludoFixtures(
  order: readonly string[],
  rounds: number,
  size: 4 | 6,
  seed: string,
  past: readonly (readonly string[])[] = [],
  fromRound = 1,
): PlannedMatch[] {
  const tables: string[][] = past.map((t) => [...t]);
  const out: PlannedMatch[] = [];
  if (order.length < 2) return out;
  for (let round = fromRound; round < fromRound + rounds; round++) {
    const { tables: today } = composeLudoTables(order, meetingCounts(tables), { maxSize: size, seed: roundSeed(seed, round) });
    today.forEach((players, i) => out.push({ stage: 'league', round, players, tie: i }));
    tables.push(...today);
  }
  return out;
}

/** Coupe : poules en serpentin, tous contre tous dans chaque poule (journées alignées). */
export function groupFixtures(order: readonly string[], groups: number, doubleRound: boolean): { groups: string[][]; matches: PlannedMatch[] } {
  const made = makeGroups(order, groups);
  const matches: PlannedMatch[] = [];
  made.forEach((players, g) => {
    for (const r of roundRobin(players, { doubleRound })) {
      for (const f of r.matches) matches.push({ stage: 'group', round: f.round, group: g, players: [f.home, f.away] });
    }
  });
  return { groups: made, matches };
}

/** Nombre de journées de la phase de poules (la plus grande poule). */
export function groupRoundCount(players: number, groups: number, doubleRound: boolean): number {
  const biggest = Math.ceil(players / groups);
  return roundRobinRoundCount(biggest, doubleRound);
}

/** Écrit les matchs prévus, à l'heure par défaut de leur journée. */
export async function insertMatches(db: Sql, league: Pick<LeagueRow, 'id' | 'first_day' | 'rhythm' | 'default_time'>, planned: readonly PlannedMatch[]): Promise<void> {
  for (const p of planned) {
    const day = dayOfRound(league, p.round);
    await db.query(
      `INSERT INTO league_matches (league_id, stage, round, group_index, tie_index, leg, level, players, day, match_at, board)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9, $10, $11)`,
      [league.id, p.stage, p.round, p.group ?? null, p.tie ?? null, p.leg ?? null, p.level ?? null, p.players, day, matchAtOf(day, league.default_time), p.board ?? null],
    );
  }
}

/** Rencontres non jouées, au format du domaine (recomposition après exclusion). */
export function asFixtures(rows: readonly { round: number; players: string[] }[]): Fixture[] {
  return rows.filter((m) => m.players.length === 2).map((m) => ({ round: m.round, home: m.players[0]!, away: m.players[1]! }));
}

/** Prévision du calendrier avant le tirage (écran 33) : journées, matchs, matchs par journée. */
export function schedulePreview(
  league: Pick<LeagueRow, 'game' | 'format' | 'double_round' | 'groups' | 'rounds' | 'board_rules'>,
  players: number,
): { rounds: number; matches: number; perRound: number } {
  if (players < 2) return { rounds: 0, matches: 0, perRound: 0 };
  if (league.game === 'ludo') {
    const rounds = ludoRoundCount(league, players);
    const perRound = ludoTableSizes(players, ludoTableSize(league)).length;
    return { rounds, matches: rounds * perRound, perRound };
  }
  if (league.format === 'cup') {
    const groups = Math.max(1, league.groups ?? 1);
    const rounds = groupRoundCount(players, groups, league.double_round);
    const sizes = Array.from({ length: groups }, (_, g) => Math.floor(players / groups) + (g < players % groups ? 1 : 0));
    const matches = sizes.reduce((s, n) => s + ((n * (n - 1)) / 2) * (league.double_round ? 2 : 1), 0);
    return { rounds, matches, perRound: sizes.reduce((s, n) => s + Math.floor(n / 2), 0) };
  }
  const rounds = roundRobinRoundCount(players, league.double_round);
  const matches = ((players * (players - 1)) / 2) * (league.double_round ? 2 : 1);
  return { rounds, matches, perRound: Math.floor(players / 2) };
}
