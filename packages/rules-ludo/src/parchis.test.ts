import { describe, expect, it } from 'vitest';
import {
  absoluteSquare,
  applyMove,
  applyRoll,
  BASE,
  barriersOf,
  controlledSeats,
  distinctMoves,
  finish,
  isSafeSquare,
  lastTrack,
  legalMoves,
  LudoError,
  newGame,
  protectedSquares,
  startSquare,
  teamRanking,
  type LudoState,
} from './index.js';

/** Place des pions à la main (les tests partent d'une position précise). */
function position(state: LudoState, tokens: number[][], current = 0): LudoState {
  return { ...state, tokens, current, phase: 'roll', roll: null, sixesInRow: 0, bonus: [], extraRoll: false, lastMoved: null };
}

/** Progression, pour la maison `home`, de la case officielle `square` (1 … 68, 68 ≡ 0). */
function prog(home: number, square: number): number {
  return (((square - 5 - 17 * home) % 68) + 68) % 68;
}

const B = BASE;
const g4 = (): LudoState => newGame({ preset: 'parchis', players: 4 });

describe('Parchís : plateau de 68 cases', () => {
  it('68 cases, sortie en 5 / 22 / 39 / 56, couloir de 7, arrivée à 71', () => {
    const c = g4().config;
    expect([0, 1, 2, 3].map((h) => startSquare(c, h))).toEqual([5, 22, 39, 56]);
    expect(lastTrack(c)).toBe(63);
    expect(finish(c)).toBe(71);
    // Entrée du couloir : 68 (≡ 0) pour la maison 0, puis 17, 34, 51.
    expect([0, 1, 2, 3].map((h) => absoluteSquare(c, h, 63))).toEqual([0, 17, 34, 51]);
    expect(absoluteSquare(c, 0, 64)).toBeNull();
  });

  it('12 cases sûres : 5, 12, 17, 22, 29, 34, 39, 46, 51, 56, 63, 68', () => {
    const c = g4().config;
    expect(protectedSquares(c)).toEqual([0, 5, 12, 17, 22, 29, 34, 39, 46, 51, 56, 63]);
    expect(isSafeSquare(c, 10)).toBe(false);
  });
});

describe('Parchís : sortie au 5', () => {
  it('il faut un 5 ; avec un 5, sortir est obligatoire quand c’est possible', () => {
    let g = position(g4(), [[10, B, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 6);
    expect(legalMoves(g).every((m) => m.from === 10)).toBe(true);
    g = position(g4(), [[10, B, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 5);
    expect(legalMoves(g).every((m) => m.from === BASE)).toBe(true);
    expect(distinctMoves(legalMoves(g))).toHaveLength(1);
  });

  it('départ plein avec un adversaire : le pion qui sort le prend (puis avance de 20)', () => {
    // Un pion à soi et un pion de la maison 1 sur la case 5 (départ de la maison 0).
    let g = position(g4(), [[0, 30, B, B], [prog(1, 5), B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 5);
    const exit = legalMoves(g).find((m) => m.from === BASE)!;
    expect(exit.captures).toEqual([{ seat: 1, token: 0 }]);
    g = applyMove(g, exit);
    expect(g.tokens[1]![0]).toBe(BASE);
    expect(g.phase).toBe('move');
    expect(g.bonus).toEqual([20]);
    expect(legalMoves(g).map((m) => [m.from, m.to])).toContainEqual([30, 50]);
  });

  it('départ occupé par sa propre barrière : on ne sort pas', () => {
    let g = position(g4(), [[0, 0, 20, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 5);
    expect(legalMoves(g).every((m) => m.from !== BASE)).toBe(true);
  });
});

describe('Parchís : barrières', () => {
  it('deux pions de même couleur : personne ne passe ni ne s’y pose', () => {
    // Barrière de la maison 1 sur la case 10 ; pion de la maison 0 en case 8.
    const tokens = [[prog(0, 8), B, B, B], [prog(1, 10), prog(1, 10), B, B], [B, B, B, B], [B, B, B, B]];
    for (const [roll, ok] of [
      [1, true],
      [2, false],
      [4, false],
    ] as const) {
      const g = applyRoll(position(g4(), tokens), roll);
      expect(legalMoves(g).length > 0).toBe(ok);
    }
    expect(barriersOf(position(g4(), tokens), 1)).toEqual([10]);
  });

  it('sa propre barrière bloque aussi ses pions', () => {
    const g = applyRoll(position(g4(), [[prog(0, 10), prog(0, 10), prog(0, 8), B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]), 4);
    expect(legalMoves(g).map((m) => m.from)).toEqual([prog(0, 10), prog(0, 10)]);
  });

  it('un 6 oblige à ouvrir la barrière', () => {
    let g = position(g4(), [[10, 10, 20, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 6);
    expect(new Set(legalMoves(g).map((m) => m.from))).toEqual(new Set([10]));
    // Avec un autre chiffre, on choisit.
    g = applyRoll(position(g4(), [[10, 10, 20, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]), 3);
    expect(new Set(legalMoves(g).map((m) => m.from))).toEqual(new Set([10, 20]));
  });

  it('deux pions au plus par case ; deux couleurs partagent une case sûre sans se prendre', () => {
    // Case 12 (sûre) : un pion de la maison 1. Le pion de la maison 0 s'y pose sans le prendre.
    let g = position(g4(), [[prog(0, 10), prog(0, 9), B, B], [prog(1, 12), B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 2);
    const m = legalMoves(g).find((x) => x.from === prog(0, 10))!;
    expect(m.captures).toEqual([]);
    g = applyMove(g, m);
    expect(g.tokens[1]![0]).toBe(prog(1, 12));
    // La case 12 est pleine : le troisième pion ne peut pas s'y poser.
    g = position(g, g.tokens, 0);
    g = applyRoll(g, 3);
    expect(legalMoves(g).find((x) => x.from === prog(0, 9))).toBeUndefined();
  });
});

describe('Parchís : capture + 20, rentrée + 10', () => {
  it('une capture renvoie à la maison et donne 20 cases à jouer, sans relance', () => {
    // Maison 0 en case 8, maison 1 en case 10 (pas sûre).
    let g = position(g4(), [[prog(0, 8), 20, B, B], [prog(1, 10), B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 2);
    g = applyMove(g, legalMoves(g).find((m) => m.from === prog(0, 8))!);
    expect(g.tokens[1]![0]).toBe(BASE);
    expect(g.bonus).toEqual([20]);
    expect(g.current).toBe(0);
    const bonus = legalMoves(g);
    expect(bonus.map((m) => m.to - m.from)).toEqual([20, 20]);
    g = applyMove(g, bonus.find((m) => m.from === 20)!);
    expect(g.tokens[0]![1]).toBe(40);
    // Pas de lancer de plus après une capture au Parchís (le 2 ne rejoue pas).
    expect(g.current).toBe(1);
  });

  it('le bonus de 20 ne sort jamais un pion ; impossible à jouer, il est perdu', () => {
    // Le seul pion en jeu est trop près de l'arrivée pour avancer de 20.
    let g = position(g4(), [[53, B, B, B], [prog(1, 60), B, B, B], [B, B, B, B], [B, B, B, B]]);
    expect(absoluteSquare(g.config, 0, 55)).toBe(60);
    g = applyRoll(g, 2);
    g = applyMove(g, { token: 0 });
    expect(g.tokens[1]![0]).toBe(BASE);
    expect(g.bonus).toEqual([]);
    expect(g.current).toBe(1);
  });

  it('rentrer un pion donne 10 cases à jouer', () => {
    let g = position(g4(), [[69, 5, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 2);
    g = applyMove(g, { token: 0 });
    expect(g.tokens[0]![0]).toBe(71);
    expect(g.bonus).toEqual([10]);
    g = applyMove(g, { token: 1 });
    expect(g.tokens[0]![1]).toBe(15);
    expect(g.current).toBe(1);
  });

  it('chiffre exact pour rentrer, couloir privé', () => {
    const g = applyRoll(position(g4(), [[68, B, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]), 4);
    expect(g.current).toBe(1);
    const h = applyRoll(position(g4(), [[68, B, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]), 3);
    expect(legalMoves(h)[0]!.to).toBe(71);
  });
});

describe('Parchís : trois 6 de suite', () => {
  it('le dernier pion bougé retourne à la base et le tour passe', () => {
    let g = position(g4(), [[10, 30, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyMove(applyRoll(g, 6), { token: 0 });
    g = applyMove(applyRoll(g, 6), { token: 1 });
    expect(g.tokens[0]).toEqual([16, 36, B, B]);
    g = applyRoll(g, 6);
    expect(g.tokens[0]).toEqual([16, BASE, B, B]);
    expect(g.current).toBe(1);
  });

  it('un pion déjà dans le couloir final n’est pas renvoyé', () => {
    let g = position(g4(), [[52, B, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyMove(applyRoll(g, 6), { token: 0 });
    g = applyMove(applyRoll(g, 6), { token: 0 });
    expect(g.tokens[0]![0]).toBe(64);
    g = applyRoll(g, 6);
    expect(g.tokens[0]![0]).toBe(64);
    expect(g.current).toBe(1);
  });
});

describe('Parchís par équipes', () => {
  it('on ne prend pas son partenaire ; qui a tout rentré joue les pions de son partenaire', () => {
    const base = newGame({ preset: 'parchis', players: 4, teams: [[0, 2], [1, 3]] });
    // Partenaire (maison 2) en case 10 : pas de capture.
    let g = position(base, [[prog(0, 8), B, B, B], [B, B, B, B], [prog(2, 10), B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 2);
    expect(legalMoves(g)[0]!.captures).toEqual([]);
    // Le siège 0 rentre son dernier pion : son bonus de 10 se joue avec les pions du siège 2.
    g = position(base, [[71, 71, 71, 69], [20, B, B, B], [10, B, B, B], [B, B, B, B]]);
    g = applyMove(applyRoll(g, 2), { token: 3 });
    expect(g.seats[0]!.status).toBe('finished');
    expect(g.ranking).toEqual([0]);
    expect(controlledSeats(g, 0)).toEqual([2]);
    expect(legalMoves(g).map((m) => [m.seat, m.from, m.to])).toEqual([[2, 10, 20]]);
    g = applyMove(g, { token: 0, seat: 2 });
    expect(g.tokens[2]![0]).toBe(20);
    expect(g.current).toBe(1);
  });

  it('l’équipe gagne quand ses deux joueurs ont tout rentré', () => {
    const base = newGame({ preset: 'parchis', players: 4, teams: [[0, 2], [1, 3]] });
    let g = position(base, [[71, 71, 71, 71], [20, B, B, B], [71, 71, 71, 68], [B, B, B, B]], 2);
    g = { ...g, seats: g.seats.map((s, i) => (i === 0 ? { ...s, status: 'finished' as const } : s)), ranking: [0] };
    g = applyMove(applyRoll(g, 3), { token: 3 });
    expect(g.phase).toBe('over');
    expect(g.ranking.slice(0, 2)).toEqual([0, 2]);
    expect(teamRanking(g)).toEqual([0, 1]);
  });
});

describe('Parchís : erreurs', () => {
  it('coup illégal, lancer hors de propos, valeur invalide', () => {
    const g = applyRoll(g4(), 5);
    expect(() => applyMove(g, { token: 0, seat: 1 })).toThrow(LudoError);
    expect(() => applyRoll(g, 3)).toThrow(LudoError);
    expect(() => applyRoll(g4(), 10)).toThrow(LudoError);
    expect(() => applyMove(g4(), { token: 0 })).toThrow(LudoError);
  });
});
