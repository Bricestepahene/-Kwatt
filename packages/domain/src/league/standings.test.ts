import { describe, expect, it } from 'vitest';
import { damesRows, damesStandings, matchPoints, rankRows, type MatchRecord } from './standings.js';
import { applyExclusion, exclusionDue } from './exclusion.js';
import type { Fixture } from './schedule.js';

const row = (rows: ReturnType<typeof damesRows>, id: string) => rows.find((r) => r.playerId === id)!;

describe('points d’une rencontre', () => {
  it('V 3 · N 1 · D 0', () => {
    const w = matchPoints({ round: 1, home: 'a', away: 'b', outcome: 'home_win', pieceDiff: 4 });
    expect([w.home.points, w.away.points]).toEqual([3, 0]);
    expect([w.home.diff, w.away.diff]).toEqual([4, -4]);
    const d = matchPoints({ round: 1, home: 'a', away: 'b', outcome: 'draw' });
    expect([d.home.points, d.away.points]).toEqual([1, 1]);
  });

  it('forfait : l’adversaire marque 3 pts, l’absent 0 et −1 de pénalité, compté 1–0', () => {
    const f = matchPoints({ round: 1, home: 'a', away: 'b', outcome: 'away_forfeit' });
    expect(f.home).toMatchObject({ points: 3, penalty: 0, win: true, diff: 1 });
    expect(f.away).toMatchObject({ points: 0, penalty: 1, forfeit: true, diff: -1 });
  });

  it('double forfait : 0 pt pour chacun, sans pénalité, mais un forfait chacun', () => {
    const f = matchPoints({ round: 1, home: 'a', away: 'b', outcome: 'double_forfeit' });
    expect(f.home).toMatchObject({ points: 0, penalty: 0, forfeit: true });
    expect(f.away).toMatchObject({ points: 0, penalty: 0, forfeit: true });
  });

  it('pénalité retranchée des points au classement', () => {
    const rows = damesRows(['a', 'b'], [
      { round: 1, home: 'a', away: 'b', outcome: 'home_forfeit' },
      { round: 2, home: 'b', away: 'a', outcome: 'draw' },
    ]);
    expect(row(rows, 'a')).toMatchObject({ points: 0, penalties: 1, forfeits: 1, played: 2, losses: 1, draws: 1 });
    expect(row(rows, 'b')).toMatchObject({ points: 4, wins: 1 });
  });
});

describe('départage (planche RegleCompet)', () => {
  it('Coupe des Cousins, poule B : Christelle 7, Armand 4, Yannick 4, Junior 1 ; Armand passe devant Yannick à la différence de pions', () => {
    const m: MatchRecord[] = [
      { round: 1, home: 'christelle', away: 'armand', outcome: 'home_win', pieceDiff: 2 },
      { round: 1, home: 'yannick', away: 'junior', outcome: 'home_win', pieceDiff: 3 },
      { round: 2, home: 'christelle', away: 'yannick', outcome: 'home_win', pieceDiff: 2 },
      { round: 2, home: 'armand', away: 'junior', outcome: 'home_win', pieceDiff: 6 },
      { round: 3, home: 'christelle', away: 'junior', outcome: 'draw' },
      { round: 3, home: 'armand', away: 'yannick', outcome: 'draw' },
    ];
    const r = damesStandings(['christelle', 'armand', 'yannick', 'junior'], m, { qualifyingPlaces: 2 });
    expect(r.rows.map((x) => [x.playerId, x.points])).toEqual([
      ['christelle', 7],
      ['armand', 4],
      ['yannick', 4],
      ['junior', 1],
    ]);
    expect(r.drawNeeded).toEqual([]);
    expect(r.playoffNeeded).toEqual([]);
  });

  it('égalité que rien ne sépare : tirage au sort vérifiable (critère 5)', () => {
    const m: MatchRecord[] = [
      { round: 1, home: 'a', away: 'b', outcome: 'home_win' },
      { round: 2, home: 'b', away: 'c', outcome: 'home_win' },
      { round: 3, home: 'c', away: 'a', outcome: 'draw' },
      { round: 4, home: 'b', away: 'd', outcome: 'home_win' },
      { round: 5, home: 'a', away: 'd', outcome: 'draw' },
      { round: 6, home: 'c', away: 'd', outcome: 'draw' },
    ];
    // a : 3 + 1 + 1 = 5 ; b : 0 + 3 + 3 = 6 ; c : 0 + 1 + 1 = 2 ; d : 0 + 1 + 1 = 2.
    const r = damesStandings(['a', 'b', 'c', 'd'], m);
    expect(r.rows.map((x) => x.playerId)).toEqual(['b', 'a', 'c', 'd']);
    // c et d : nulle entre eux, aucune victoire, différence 0 → tirage au sort nécessaire.
    expect(r.drawNeeded).toEqual([['c', 'd']]);
    const drawn = damesStandings(['a', 'b', 'c', 'd'], m, { draw: ['d', 'c'] });
    expect(drawn.rows.map((x) => x.playerId)).toEqual(['b', 'a', 'd', 'c']);
    expect(drawn.drawNeeded).toEqual([]);
  });

  it('trois à égalité : la confrontation directe isole le premier, puis se réapplique aux deux autres', () => {
    const m: MatchRecord[] = [
      { round: 1, home: 'a', away: 'b', outcome: 'home_win' },
      { round: 2, home: 'a', away: 'c', outcome: 'home_win' },
      { round: 3, home: 'b', away: 'c', outcome: 'draw' },
      { round: 4, home: 'b', away: 'x', outcome: 'home_win', pieceDiff: 1 },
      { round: 4, home: 'c', away: 'y', outcome: 'home_win', pieceDiff: 8 },
      { round: 5, home: 'b', away: 'y', outcome: 'home_win', pieceDiff: 1 },
      { round: 5, home: 'c', away: 'x', outcome: 'home_win', pieceDiff: 1 },
      { round: 6, home: 'x', away: 'a', outcome: 'draw' },
      { round: 7, home: 'y', away: 'a', outcome: 'home_win' },
    ];
    // a, b, c : 7 points chacun. Entre eux : a 6, b 1, c 1 ; puis b–c nulle, victoires 2–2, différence c > b.
    const r = damesStandings(['a', 'b', 'c', 'x', 'y'], m);
    expect(r.rows.slice(0, 3).map((x) => [x.playerId, x.points])).toEqual([
      ['a', 7],
      ['c', 7],
      ['b', 7],
    ]);
  });

  it('après un critère qui sépare, la confrontation directe repart pour le sous-groupe', () => {
    const r = rankRows({
      rows: [
        { playerId: 'a', played: 5, wins: 3, draws: 0, losses: 2, forfeits: 0, penalties: 0, points: 9, tiebreakValue: 0 },
        { playerId: 'b', played: 5, wins: 2, draws: 3, losses: 0, forfeits: 0, penalties: 0, points: 9, tiebreakValue: 0 },
        { playerId: 'c', played: 5, wins: 2, draws: 3, losses: 0, forfeits: 0, penalties: 0, points: 9, tiebreakValue: 5 },
      ],
      headToHead(group) {
        if (group.length === 3) return new Map(group.map((id) => [id, 2]));
        return new Map([
          ['b', 3],
          ['c', 0],
        ]);
      },
    });
    expect(r.rows.map((x) => x.playerId)).toEqual(['a', 'b', 'c']);
  });

  it('place qualificative : manche décisive de 5 minutes au lieu du tirage', () => {
    const m: MatchRecord[] = [
      { round: 1, home: 'a', away: 'b', outcome: 'home_win' },
      { round: 1, home: 'c', away: 'd', outcome: 'draw' },
    ];
    const r = damesStandings(['a', 'b', 'c', 'd'], m, { qualifyingPlaces: 2 });
    // c et d (1 pt chacun) se disputent la 2e place.
    expect(r.playoffNeeded).toEqual([['c', 'd']]);
    expect(r.drawNeeded).toEqual([]);
    const done = damesStandings(['a', 'b', 'c', 'd'], m, { qualifyingPlaces: 2, playoffOrder: ['d', 'c'] });
    expect(done.rows.map((x) => x.playerId)).toEqual(['a', 'd', 'c', 'b']);
    expect(done.playoffNeeded).toEqual([]);
  });
});

describe('exclusion (planche RegleLigues, écran 35)', () => {
  it('exclu après 2 forfaits de suite ou 3 au total', () => {
    const two: MatchRecord[] = [
      { round: 1, home: 'f', away: 'a', outcome: 'home_win' },
      { round: 2, home: 'f', away: 'b', outcome: 'home_forfeit' },
      { round: 3, home: 'c', away: 'f', outcome: 'away_forfeit' },
    ];
    expect(exclusionDue('f', two)).toBe(true);
    expect(exclusionDue('f', two.slice(0, 2))).toBe(false);
    const spread: MatchRecord[] = [
      { round: 1, home: 'f', away: 'a', outcome: 'home_forfeit' },
      { round: 2, home: 'f', away: 'b', outcome: 'draw' },
      { round: 3, home: 'c', away: 'f', outcome: 'double_forfeit' },
      { round: 4, home: 'f', away: 'd', outcome: 'away_win' },
      { round: 5, home: 'e', away: 'f', outcome: 'away_forfeit' },
    ];
    expect(exclusionDue('f', spread)).toBe(true);
    expect(exclusionDue('f', spread.slice(0, 4))).toBe(false);
    // Le double forfait compte aussi pour l'adversaire.
    expect(exclusionDue('c', spread)).toBe(false);
  });

  it('Fotso : 5 matchs sur 13 (3 joués, 2 forfaits), moins de la moitié → tout est annulé ; 61 rendus', () => {
    const before: MatchRecord[] = [
      { round: 1, home: 'fotso', away: 'ewane', outcome: 'draw' },
      { round: 2, home: 'mireille', away: 'fotso', outcome: 'home_win', pieceDiff: 3 },
      { round: 3, home: 'fotso', away: 'yannick', outcome: 'home_win', pieceDiff: 2 },
      { round: 4, home: 'ngono', away: 'fotso', outcome: 'away_forfeit' },
      { round: 5, home: 'fotso', away: 'kamga', outcome: 'home_forfeit' },
      { round: 5, home: 'mireille', away: 'yannick', outcome: 'draw' },
    ];
    expect(exclusionDue('fotso', before)).toBe(true);
    const unplayed: Fixture[] = [
      { round: 6, home: 'fotso', away: 'odile' },
      { round: 7, home: 'paul', away: 'fotso' },
      { round: 6, home: 'mireille', away: 'ewane' },
    ];
    const res = applyExclusion({ excluded: 'fotso', matches: before, unplayed, totalMatches: 13, entry: 200 });
    expect(res).toMatchObject({ policy: 'annulled', elapsed: 5, remaining: 8, refund: 61 });
    expect(res.annulled).toHaveLength(5);
    expect(res.unplayed).toEqual([{ round: 6, home: 'mireille', away: 'ewane' }]);

    const players = ['fotso', 'ewane', 'mireille', 'yannick', 'ngono', 'kamga'];
    const was = damesRows(players, before);
    const now = damesRows(players, res.matches);
    // Mireille, qui l'avait battu à J2, perd 3 pts.
    expect(row(was, 'mireille').points - row(now, 'mireille').points).toBe(3);
    // Yannick, battu par lui, n'a plus cette défaite.
    expect(row(was, 'yannick').losses).toBe(1);
    expect(row(now, 'yannick').losses).toBe(0);
    // Ngono et Kamga perdent leurs victoires par forfait.
    expect(row(now, 'ngono').points).toBe(0);
    expect(row(now, 'kamga').points).toBe(0);
  });

  it('Tchoumi : 6 matchs sur 13, moins de la moitié → toi −3, Ngono −3, Ewane défaite effacée, Odile −1 ; 53 rendus', () => {
    const before: MatchRecord[] = [
      { round: 1, home: 'ngono', away: 'tchoumi', outcome: 'home_win' },
      { round: 2, home: 'tchoumi', away: 'ewane', outcome: 'home_win' },
      { round: 3, home: 'odile', away: 'tchoumi', outcome: 'draw' },
      { round: 4, home: 'tchoumi', away: 'paul', outcome: 'away_win' },
      { round: 5, home: 'kamga', away: 'tchoumi', outcome: 'away_forfeit' },
      { round: 6, home: 'tchoumi', away: 'brice', outcome: 'home_forfeit' },
    ];
    const res = applyExclusion({ excluded: 'tchoumi', matches: before, unplayed: [], totalMatches: 13, entry: 200 });
    expect(res).toMatchObject({ policy: 'annulled', elapsed: 6, remaining: 7, refund: 53 });
    const players = ['tchoumi', 'ngono', 'ewane', 'odile', 'paul', 'kamga', 'brice'];
    const was = damesRows(players, before);
    const now = damesRows(players, res.matches);
    const lost = (id: string): number => row(was, id).points - row(now, id).points;
    expect(lost('brice')).toBe(3);
    expect(lost('ngono')).toBe(3);
    expect(lost('odile')).toBe(1);
    expect(row(was, 'ewane').losses - row(now, 'ewane').losses).toBe(1);
  });

  it('la moitié ou plus : ses résultats restent, ses matchs restants deviennent des victoires 1–0', () => {
    const before: MatchRecord[] = Array.from({ length: 7 }, (_, i) => ({
      round: i + 1,
      home: 'z',
      away: `o${i + 1}`,
      outcome: i < 5 ? ('home_win' as const) : ('home_forfeit' as const),
      pieceDiff: i < 5 ? 2 : 0,
    }));
    const unplayed: Fixture[] = [
      { round: 8, home: 'z', away: 'o8' },
      { round: 9, home: 'o9', away: 'z' },
      { round: 9, home: 'o1', away: 'o2' },
    ];
    const res = applyExclusion({ excluded: 'z', matches: before, unplayed, totalMatches: 13, entry: 200 });
    expect(res.policy).toBe('kept');
    expect(res.elapsed).toBe(7);
    expect(res.refund).toBe(Math.floor((200 * 6) / 26));
    expect(res.awarded).toEqual([
      { round: 8, home: 'z', away: 'o8', outcome: 'away_awarded' },
      { round: 9, home: 'o9', away: 'z', outcome: 'home_awarded' },
    ]);
    const rows = damesRows(['z', 'o8', 'o9'], res.matches);
    expect(row(rows, 'o8')).toMatchObject({ points: 3, wins: 1, tiebreakValue: 1 });
    expect(row(rows, 'o9')).toMatchObject({ points: 3, wins: 1, tiebreakValue: 1 });
    expect(res.unplayed).toEqual([{ round: 9, home: 'o1', away: 'o2' }]);
  });
});
