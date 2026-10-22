import { describe, expect, it } from 'vitest';
import {
  groupByRound,
  matchesPerPlayer,
  minimumRounds,
  packFixtures,
  recomposeAfterExclusions,
  roundRobin,
  roundRobinMatchCount,
  roundRobinRoundCount,
  withExcludedAsBye,
  type Fixture,
  type Round,
} from './schedule.js';

const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
const pair = (f: Pick<Fixture, 'home' | 'away'>): string => [f.home, f.away].sort().join('|');

/** Vérifie qu'un calendrier est valide : chacun au plus une fois par journée, chaque paire le bon nombre de fois. */
function checkRounds(rounds: Round[], players: string[], meetings: number): void {
  const count = new Map<string, number>();
  for (const r of rounds) {
    const busy = new Set<string>();
    for (const m of r.matches) {
      expect(m.round).toBe(r.round);
      expect(busy.has(m.home) || busy.has(m.away)).toBe(false);
      busy.add(m.home);
      busy.add(m.away);
      count.set(pair(m), (count.get(pair(m)) ?? 0) + 1);
    }
    for (const b of r.byes) expect(busy.has(b)).toBe(false);
    expect(busy.size + r.byes.length).toBe(players.length);
  }
  expect(count.size).toBe((players.length * (players.length - 1)) / 2);
  for (const c of count.values()) expect(c).toBe(meetings);
}

describe('méthode du cercle', () => {
  it('14 joueurs = 13 journées, 7 matchs par jour, 91 matchs (aller simple)', () => {
    const players = names(14);
    const rounds = roundRobin(players);
    expect(rounds).toHaveLength(13);
    for (const r of rounds) {
      expect(r.matches).toHaveLength(7);
      expect(r.byes).toEqual([]);
    }
    checkRounds(rounds, players, 1);
    expect(roundRobinMatchCount(14)).toBe(91);
    expect(roundRobinRoundCount(14)).toBe(13);
    expect(matchesPerPlayer(14)).toBe(13);
  });

  it('nombre impair : un exempt par journée, chacun se repose une fois', () => {
    const players = names(13);
    const rounds = roundRobin(players);
    expect(rounds).toHaveLength(13);
    const rested = rounds.flatMap((r) => r.byes);
    expect(rested.sort()).toEqual([...players].sort());
    for (const r of rounds) expect(r.matches).toHaveLength(6);
    checkRounds(rounds, players, 1);
    expect(roundRobinRoundCount(13)).toBe(13);
  });

  it('aller-retour : Championnat du Kwatt, 10 joueurs = 18 journées, domicile inversé au retour', () => {
    const players = names(10);
    const rounds = roundRobin(players, { doubleRound: true });
    expect(rounds).toHaveLength(18);
    expect(roundRobinRoundCount(10, true)).toBe(18);
    expect(roundRobinMatchCount(10, true)).toBe(90);
    expect(matchesPerPlayer(10, true)).toBe(18);
    checkRounds(rounds, players, 2);
    const firstLeg = rounds[0]!.matches[0]!;
    const secondLeg = rounds[9]!.matches[0]!;
    expect([secondLeg.home, secondLeg.away]).toEqual([firstLeg.away, firstLeg.home]);
  });

  it('domicile et extérieur alternent pour le joueur fixe', () => {
    const rounds = roundRobin(names(8));
    const homes = rounds.map((r) => r.matches.some((m) => m.home === 'p01'));
    expect(homes.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(homes.filter((h) => !h).length).toBeGreaterThanOrEqual(3);
  });

  it('déterministe, refuse les doublons et les ligues d’un seul joueur', () => {
    expect(roundRobin(names(6))).toEqual(roundRobin(names(6)));
    expect(() => roundRobin(['a', 'a'])).toThrow();
    expect(() => roundRobin(['a'])).toThrow();
  });
});

describe('recomposer le calendrier (planche RegleLigues)', () => {
  const players = names(14);
  const rounds = roundRobin(players);
  const playedAfter = (n: number): Fixture[] => rounds.slice(0, n).flatMap((r) => r.matches);
  const unplayedAfter = (n: number): Fixture[] => rounds.slice(n).flatMap((r) => r.matches);

  it('1 exclu à J5 : 13 joueurs, 78 − 30 joués = 48 matchs, 6 par jour → 8 journées, fin inchangée (J13)', () => {
    const excluded = 'p05';
    const present = players.filter((p) => p !== excluded);
    const playedPresent = playedAfter(5).filter((f) => f.home !== excluded && f.away !== excluded);
    expect(playedPresent).toHaveLength(30);
    const remaining = unplayedAfter(5).filter((f) => f.home !== excluded && f.away !== excluded);
    expect(remaining).toHaveLength(78 - 30);
    expect(minimumRounds(remaining, present.length)).toBe(8);

    const rec = recomposeAfterExclusions({ unplayed: unplayedAfter(5), players, excluded: [excluded], fromRound: 6 });
    expect(rec.mode).toBe('bye');
    expect(rec.lastRound).toBe(13);
    expect(rec.fixtures).toHaveLength(48);
    // Aucun autre match ne bouge.
    for (const f of rec.fixtures) expect(unplayedAfter(5)).toContainEqual(f);
    // Son adversaire du jour se repose : un par journée de J6 à J13.
    expect(rec.rested.map((r) => r.round)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('Tchoumi exclu après J6 (écran 35) : 42 matchs restants, 6 par journée, fin inchangée', () => {
    const excluded = 'p12';
    const rec = recomposeAfterExclusions({ unplayed: unplayedAfter(6), players, excluded: [excluded], fromRound: 7 });
    expect(rec.fixtures).toHaveLength(42);
    expect(minimumRounds(rec.fixtures, 13)).toBe(7);
    expect(rec.lastRound).toBe(13);
    expect(rec.rested).toHaveLength(7);
  });

  it('2 exclus à J5 : 12 joueurs, 66 − 25 = 41 matchs, un joueur a encore 7 matchs → 7 journées, fin un jour plus tôt', () => {
    const excluded = ['p02', 'p03'];
    const present = players.filter((p) => !excluded.includes(p));
    const playedPresent = playedAfter(5).filter((f) => !excluded.includes(f.home) && !excluded.includes(f.away));
    expect(playedPresent).toHaveLength(25);
    const remaining = unplayedAfter(5).filter((f) => !excluded.includes(f.home) && !excluded.includes(f.away));
    expect(remaining).toHaveLength(41);
    const load = new Map<string, number>();
    for (const f of remaining) for (const p of [f.home, f.away]) load.set(p, (load.get(p) ?? 0) + 1);
    expect(Math.max(...load.values())).toBe(7);
    expect(minimumRounds(remaining, present.length)).toBe(7);

    const rec = recomposeAfterExclusions({ unplayed: unplayedAfter(5), players, excluded, fromRound: 6 });
    expect(rec.mode).toBe('repacked');
    expect(rec.fixtures).toHaveLength(41);
    expect(rec.lastRound).toBe(12);
    // Mêmes rencontres, chacun au plus une fois par jour.
    expect(rec.fixtures.map(pair).sort()).toEqual(remaining.map(pair).sort());
    for (const r of groupByRound(rec.fixtures, present)) {
      const busy = r.matches.flatMap((m) => [m.home, m.away]);
      expect(new Set(busy).size).toBe(busy.length);
    }
  });

  it('rangement minimal sur un aller-retour incomplet, déterministe', () => {
    const p = names(6);
    const rr = roundRobin(p, { doubleRound: true });
    const left = rr.slice(3).flatMap((r) => r.matches);
    const packed = packFixtures(left, p, 4);
    expect(new Set(packed.map((f) => f.round)).size).toBe(minimumRounds(left, 6));
    expect(packFixtures(left, p, 4)).toEqual(packed);
    expect(packFixtures([], p, 1)).toEqual([]);
  });

  it('un exclu en mode « exempt » : la liste des repos', () => {
    const f: Fixture[] = [
      { round: 7, home: 'a', away: 'x' },
      { round: 7, home: 'b', away: 'c' },
      { round: 8, home: 'x', away: 'd' },
    ];
    expect(withExcludedAsBye(f, 'x')).toEqual({
      fixtures: [{ round: 7, home: 'b', away: 'c' }],
      rested: [
        { round: 7, player: 'a' },
        { round: 8, player: 'd' },
      ],
    });
  });
});
