import { describe, expect, it } from 'vitest';
import {
  compositionCost,
  composeLudoTables,
  ludoStandings,
  ludoTablePoints,
  ludoTableScores,
  ludoTableSizes,
  meetingCounts,
} from './ludo.js';
import {
  damesTeamMatch,
  effectiveLineup,
  homeColorOnBoard,
  lineupEditable,
  lineupVisible,
  ludoTeamMatch,
  ludoTeamRanking,
  splitTeamPot,
  teamBoards,
  teamStandings,
} from './teams.js';
import { deciderWhite, gameScore, groupName, groupQualifiers, groupStandings, knockoutPairs, makeGroups, nextRoundPairs, twoLegTie } from './cup.js';
import { boardAllowed, boardChoiceDeadline, boardIsRated, decideBoard, validateBoardRules, type BoardRules } from './boards.js';

const H = 3_600_000;
const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);

describe('Ludo en ligue : composer les tables (planche RegleCompet)', () => {
  it('points : 4 · 2 · 1 · 0 à 4 ; 4 · 2 · 0 à 3 ; 4 · 2 · 1 · 1 · 1 · 0 à 6', () => {
    expect(ludoTablePoints(4)).toEqual([4, 2, 1, 0]);
    expect(ludoTablePoints(3)).toEqual([4, 2, 0]);
    expect(ludoTablePoints(6)).toEqual([4, 2, 1, 1, 1, 0]);
    expect(ludoTablePoints(2)).toEqual([4, 0]);
    expect(() => ludoTablePoints(1)).toThrow();
  });

  it('14 joueurs = 2 tables de 4 et 2 tables de 3', () => {
    expect(ludoTableSizes(14)).toEqual([4, 4, 3, 3]);
    expect(ludoTableSizes(12)).toEqual([4, 4, 4]);
    expect(ludoTableSizes(13)).toEqual([4, 3, 3, 3]);
    expect(ludoTableSizes(12, 6)).toEqual([6, 6]);
    expect(ludoTableSizes(14, 6)).toEqual([5, 5, 4]);
  });

  it('recompose les tables pour que deux joueurs se croisent le moins souvent possible', () => {
    const players = names(16);
    const day1 = [players.slice(0, 4), players.slice(4, 8), players.slice(8, 12), players.slice(12, 16)];
    const meetings = meetingCounts(day1);
    expect(compositionCost(day1, meetings)).toBe(24);
    const day2 = composeLudoTables(players, meetings, { seed: 7 });
    // Chaque nouvelle table prend un joueur de chaque ancienne table : aucune rencontre répétée.
    expect(day2.cost).toBe(0);
    expect(day2.tables.flat().sort()).toEqual([...players].sort());
    expect(composeLudoTables(players, meetings, { seed: 7 })).toEqual(day2);

    // 8 joueurs en 2 tables de 4 : au mieux 2 paires déjà vues par table.
    const eight = names(8);
    const m8 = meetingCounts([eight.slice(0, 4), eight.slice(4)]);
    expect(composeLudoTables(eight, m8, { seed: 1 }).cost).toBe(4);
  });

  it('un joueur exclu laisse sa place : la table joue à 3 (4, 2, 0)', () => {
    const scores = ludoTableScores({
      round: 3,
      seats: [
        { playerId: 'a', place: 2, tokensHome: 3 },
        { playerId: 'b', place: 1, tokensHome: 4 },
        { playerId: 'c', place: 3, tokensHome: 1 },
      ],
    });
    expect(Object.fromEntries(scores)).toEqual({ a: 2, b: 4, c: 0 });
  });

  it('classement : points de table, puis confrontation directe, victoires, pions rentrés', () => {
    const r = ludoStandings(['a', 'b', 'c', 'd'], [
      {
        round: 1,
        seats: [
          { playerId: 'a', place: 1, tokensHome: 4 },
          { playerId: 'b', place: 2, tokensHome: 3 },
          { playerId: 'c', place: 3, tokensHome: 2 },
          { playerId: 'd', place: 4, tokensHome: 0 },
        ],
      },
      {
        round: 2,
        seats: [
          { playerId: 'b', place: 1, tokensHome: 4 },
          { playerId: 'a', place: 2, tokensHome: 2 },
          { playerId: 'd', place: 3, tokensHome: 1 },
          { playerId: 'c', place: 4, tokensHome: 1 },
        ],
      },
    ]);
    // a : 4 + 2 = 6 ; b : 2 + 4 = 6 ; c : 1 + 0 ; d : 0 + 1. a et b : 1 fois devant l'autre chacun, 1 victoire chacun, pions 6 contre 7.
    expect(r.rows.map((x) => [x.playerId, x.points])).toEqual([
      ['b', 6],
      ['a', 6],
      ['c', 1],
      ['d', 1],
    ]);
    // c et d : d a fini devant c au tour 2, c devant d au tour 1 ; pions 3 contre 1.
    expect(r.drawNeeded).toEqual([]);
  });
});

describe('matchs par équipes', () => {
  it('Dames, équipes de 3 : partie gagnée 2, nulle 1 ; rencontre gagnée 3, nulle 1', () => {
    expect(damesTeamMatch(['home', 'home', 'draw'])).toEqual({
      homeGamePoints: 5,
      awayGamePoints: 1,
      winner: 'home',
      homeLeaguePoints: 3,
      awayLeaguePoints: 0,
    });
    expect(damesTeamMatch(['home', 'draw', 'away'])).toMatchObject({ winner: null, homeLeaguePoints: 1, awayLeaguePoints: 1 });
    expect(() => damesTeamMatch(['home', 'away'])).toThrow();
  });

  it('l’équipe qui reçoit a les blancs sur les planches 1 et 3', () => {
    expect([1, 2, 3].map(homeColorOnBoard)).toEqual(['w', 'b', 'w']);
    expect(teamBoards(['h1', 'h2', 'h3'], ['a1', 'a2', 'a3'])).toEqual([
      { board: 1, white: 'h1', black: 'a1' },
      { board: 2, white: 'a2', black: 'h2' },
      { board: 3, white: 'h3', black: 'a3' },
    ]);
    expect(() => homeColorOnBoard(4)).toThrow();
  });

  it('ordre déposé 1 h avant ; personne ne voit celui de l’autre avant', () => {
    const matchAt = Date.UTC(2026, 10, 2, 17);
    expect(lineupVisible({ now: matchAt - 2 * H, matchAt })).toBe(false);
    expect(lineupEditable({ now: matchAt - 2 * H, matchAt })).toBe(true);
    expect(lineupVisible({ now: matchAt - H, matchAt })).toBe(true);
    expect(lineupEditable({ now: matchAt - H, matchAt })).toBe(false);
    expect(effectiveLineup(null, ['x', 'y', 'z', 'w'])).toEqual(['x', 'y', 'z']);
    expect(effectiveLineup(['z', 'x', 'w'], ['x', 'y', 'z', 'w'])).toEqual(['z', 'x', 'w']);
    expect(() => effectiveLineup(['x', 'x', 'y'], ['x', 'y', 'z'])).toThrow();
    expect(() => effectiveLineup(['x', 'y', 'q'], ['x', 'y', 'z'])).toThrow();
  });

  it('Ludo, équipes de 2 : somme des places, la plus petite gagne', () => {
    const r = ludoTeamRanking({ rouge: ['a', 'c'], bleu: ['b', 'd'] }, { a: 1, b: 2, c: 4, d: 3 });
    // rouge 5, bleu 5 : à égalité, l'équipe du mieux placé (a, 1er).
    expect(r.map((t) => [t.team, t.placeSum, t.rank])).toEqual([
      ['rouge', 5, 1],
      ['bleu', 5, 2],
    ]);
    const s = ludoTeamRanking({ rouge: ['a', 'c'], bleu: ['b', 'd'] }, { a: 1, b: 2, c: 3, d: 4 });
    expect(s[0]!.team).toBe('rouge');
    expect(() => ludoTeamRanking({ rouge: ['a'] }, {})).toThrow();
  });

  it('double forfait sur une planche : personne ne marque ; sur les trois, rencontre nulle et vide', () => {
    expect(damesTeamMatch(['home', 'void', 'away'])).toMatchObject({ homeGamePoints: 2, awayGamePoints: 2, winner: null, homeLeaguePoints: 1 });
    expect(damesTeamMatch(['void', 'void', 'void'])).toEqual({ homeGamePoints: 0, awayGamePoints: 0, winner: null, homeLeaguePoints: 0, awayLeaguePoints: 0 });
  });

  it('rencontre de Ludo par équipes : absent compté dernier, équipe absente perdante, table vide sans points', () => {
    expect(ludoTeamMatch({ home: [1, 4], away: [2, 3], homeTokens: 5, awayTokens: 6, tableSize: 4 })).toMatchObject({
      winner: 'home',
      homeLeaguePoints: 3,
      awayLeaguePoints: 0,
      homeGamePoints: 5,
      awayGamePoints: 6,
    });
    expect(ludoTeamMatch({ home: [2, null], away: [1, 3], homeTokens: 4, awayTokens: 6, tableSize: 4 }).winner).toBe('away');
    expect(ludoTeamMatch({ home: [null, null], away: [1, 2], homeTokens: 0, awayTokens: 0, tableSize: 4 }).winner).toBe('away');
    expect(ludoTeamMatch({ home: [null, null], away: [null, null], homeTokens: 0, awayTokens: 0, tableSize: 4 })).toMatchObject({
      winner: null,
      homeLeaguePoints: 0,
      awayLeaguePoints: 0,
    });
  });

  it('classement des équipes : la confrontation directe passe avant les victoires et la différence', () => {
    // A, B et D à 3 points. B a une meilleure différence que A, mais A a battu B.
    const rows = teamStandings(['A', 'B', 'C', 'D'], [
      { round: 1, home: 'A', away: 'B', score: damesTeamMatch(['home', 'draw', 'draw']) },
      { round: 2, home: 'B', away: 'C', score: damesTeamMatch(['home', 'home', 'home']) },
      { round: 3, home: 'D', away: 'A', score: damesTeamMatch(['home', 'home', 'home']) },
    ]);
    expect(rows.map((r) => [r.team, r.points])).toEqual([
      ['D', 3],
      ['A', 3],
      ['B', 3],
      ['C', 0],
    ]);
  });

  it('classement des équipes : points, confrontation, victoires, différence de parties, tirage', () => {
    const rows = teamStandings(
      ['A', 'B', 'C', 'D'],
      [
        { round: 1, home: 'A', away: 'B', score: damesTeamMatch(['home', 'home', 'draw']) },
        { round: 1, home: 'C', away: 'D', score: damesTeamMatch(['home', 'away', 'home']) },
        { round: 2, home: 'A', away: 'C', score: damesTeamMatch(['draw', 'draw', 'draw']) },
        { round: 2, home: 'B', away: 'D', score: damesTeamMatch(['void', 'void', 'void']) },
      ],
      ['D', 'C', 'B', 'A'],
    );
    expect(rows.map((r) => [r.team, r.points, r.gamesFor - r.gamesAgainst])).toEqual([
      ['A', 4, 4],
      ['C', 4, 2],
      ['D', 0, -2],
      ['B', 0, -4],
    ]);
    expect(rows[0]).toMatchObject({ played: 2, wins: 1, draws: 1, losses: 0 });
    expect(rows.find((r) => r.team === 'B')).toMatchObject({ played: 2, wins: 0, draws: 0, losses: 2 });
  });

  it('cagnotte d’équipe : parts égales, le reste au capitaine', () => {
    expect(splitTeamPot(100, ['a', 'b', 'c'], 'b')).toEqual({ a: 33, b: 34, c: 33 });
    expect(splitTeamPot(0, ['a'], 'a')).toEqual({});
  });
});

describe('coupe (écrans 28 et 30)', () => {
  it('8 joueurs, 2 poules de 4, en serpentin', () => {
    expect(makeGroups(names(8), 2)).toEqual([
      ['p01', 'p04', 'p05', 'p08'],
      ['p02', 'p03', 'p06', 'p07'],
    ]);
    expect(groupName(0)).toBe('A');
    expect(groupName(1)).toBe('B');
    expect(() => makeGroups(names(3), 2)).toThrow();
  });

  it('qualifiés d’une poule : les 2 premiers', () => {
    const r = groupStandings(['a', 'b', 'c'], [
      { round: 1, home: 'a', away: 'b', outcome: 'home_win' },
      { round: 2, home: 'b', away: 'c', outcome: 'home_win' },
      { round: 3, home: 'c', away: 'a', outcome: 'away_win' },
    ], 2);
    expect(groupQualifiers(r, 2)).toEqual(['a', 'b']);
  });

  it('phase finale : A1–B2, B1–A2, aller-retour, puis finale', () => {
    const ties = knockoutPairs([
      ['toi', 'mireille'],
      ['christelle', 'armand'],
    ]);
    expect(ties).toEqual([
      { first: 'armand', second: 'toi' },
      { first: 'mireille', second: 'christelle' },
    ]);
    expect(nextRoundPairs(['toi', 'christelle'])).toEqual([{ first: 'toi', second: 'christelle' }]);
    expect(() => nextRoundPairs(['a'])).toThrow();
    expect(knockoutPairs([['a'], ['b'], ['c'], ['d']])).toEqual([
      { first: 'b', second: 'a' },
      { first: 'd', second: 'c' },
    ]);
    expect(() => knockoutPairs([['a', 'b'], ['c', 'd'], ['e', 'f']])).toThrow();
  });

  it('demi 1 : 1–1 à l’aller ; égalité après le retour → manche décisive de 5 minutes', () => {
    const tie = { first: 'armand', second: 'toi' };
    expect(gameScore('draw')).toEqual([1, 1]);
    expect(twoLegTie(tie, 'draw', null)).toEqual({ firstScore: 1, secondScore: 1, winner: null, deciderNeeded: false });
    expect(twoLegTie(tie, 'draw', 'draw')).toEqual({ firstScore: 2, secondScore: 2, winner: null, deciderNeeded: true });
    expect(twoLegTie(tie, 'draw', 'second')).toMatchObject({ firstScore: 1, secondScore: 3, winner: 'toi' });
    // Une manche décisive nulle se rejoue, couleurs inversées.
    expect(twoLegTie(tie, 'first', 'second', ['draw'])).toMatchObject({ winner: null, deciderNeeded: true });
    expect(twoLegTie(tie, 'first', 'second', ['draw', 'second'])).toMatchObject({ winner: 'toi', deciderNeeded: true });
    expect(deciderWhite(tie, 0)).toBe('toi');
    expect(deciderWhite(tie, 1)).toBe('armand');
  });

  it('demi 2 : Christelle (B1) 2, Mireille (A2) 0 après l’aller', () => {
    expect(twoLegTie({ first: 'mireille', second: 'christelle' }, 'second', null)).toMatchObject({ firstScore: 0, secondScore: 2, winner: null });
  });
});

describe('choisir la planche (écrans 28b et 34b)', () => {
  const matchAt = Date.UTC(2026, 10, 2, 17);
  const home: BoardRules = { policy: 'home', allowed: ['dames10', 'dames8'], defaultBoard: 'dames10' };

  it('qui reçoit choisit jusqu’à 24 h avant ; sinon, la planche par défaut', () => {
    expect(boardChoiceDeadline(matchAt)).toBe(matchAt - 24 * H);
    expect(decideBoard({ rules: home, round: 2, matchAt, hostChoice: { board: 'dames8', at: matchAt - 30 * H } })).toEqual({ board: 'dames8', source: 'host' });
    expect(decideBoard({ rules: home, round: 2, matchAt, hostChoice: { board: 'dames8', at: matchAt - 24 * H } }).board).toBe('dames8');
    expect(decideBoard({ rules: home, round: 2, matchAt, hostChoice: { board: 'dames8', at: matchAt - 23 * H } })).toEqual({ board: 'dames10', source: 'default' });
    expect(decideBoard({ rules: home, round: 2, matchAt, hostChoice: null })).toEqual({ board: 'dames10', source: 'default' });
    // Planche hors de la liste permise : ignorée.
    expect(decideBoard({ rules: { ...home, allowed: ['dames10'] }, round: 2, matchAt, hostChoice: { board: 'dames8', at: 0 } }).source).toBe('default');
  });

  it('imposée, une par journée, commun accord', () => {
    expect(decideBoard({ rules: { policy: 'imposed', allowed: ['dames10'], defaultBoard: 'dames10' }, round: 5, matchAt })).toEqual({ board: 'dames10', source: 'imposed' });
    const rot: BoardRules = { policy: 'rotation', allowed: ['ludo_classique', 'ludo_rapide', 'ludo_six'], defaultBoard: 'ludo_classique' };
    expect([1, 2, 3, 4].map((round) => decideBoard({ rules: rot, round, matchAt }).board)).toEqual(['ludo_classique', 'ludo_rapide', 'ludo_six', 'ludo_classique']);
    const agree: BoardRules = { policy: 'agreement', allowed: ['dames10', 'dames8'], defaultBoard: 'dames10' };
    const early = matchAt - 48 * H;
    expect(decideBoard({ rules: agree, round: 1, matchAt, proposals: [{ board: 'dames8', at: early }, { board: 'dames8', at: early }] })).toEqual({ board: 'dames8', source: 'agreement' });
    expect(decideBoard({ rules: agree, round: 1, matchAt, proposals: [{ board: 'dames8', at: early }, { board: 'dames10', at: early }] }).source).toBe('default');
    expect(decideBoard({ rules: agree, round: 1, matchAt, proposals: [{ board: 'dames8', at: early }, null] }).source).toBe('default');
  });

  it('ce qui est permis où', () => {
    expect(boardAllowed('dames8', 'public_league', true)).toBe(true);
    expect(boardAllowed('ludo_six', 'stake_challenge', false)).toBe(true);
    expect(boardAllowed('ludo_parchis', 'public_league', true)).toBe(false);
    expect(boardAllowed('ludo_pachisi', 'private_league', true)).toBe(true);
    expect(boardAllowed('ludo_pachisi', 'stake_challenge', false)).toBe(false);
    expect(boardAllowed('ludo_house', 'private_league', false)).toBe(true);
    expect(boardAllowed('ludo_house', 'private_league', true)).toBe(false);
    expect(boardIsRated('dames8')).toBe(true);
    expect(boardIsRated('ludo_parchis')).toBe(false);
  });

  it('validation des règles de la compétition', () => {
    expect(validateBoardRules(home, 'private_league', true)).toBeNull();
    expect(validateBoardRules({ ...home, allowed: [] }, 'private_league', true)).toBe('competition.boards_empty');
    expect(validateBoardRules({ ...home, policy: 'imposed' }, 'private_league', true)).toBe('competition.imposed_single_board');
    expect(validateBoardRules({ ...home, defaultBoard: 'ludo_six' }, 'private_league', true)).toBe('competition.default_not_allowed');
    expect(validateBoardRules({ policy: 'rotation', allowed: ['ludo_classique', 'ludo_parchis'], defaultBoard: 'ludo_classique' }, 'public_league', true)).toBe(
      'competition.board_not_allowed',
    );
  });
});
