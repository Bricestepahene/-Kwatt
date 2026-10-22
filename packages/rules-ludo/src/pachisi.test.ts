import { describe, expect, it } from 'vitest';
import {
  absoluteSquare,
  applyMove,
  applyRoll,
  BASE,
  controlledSeats,
  cowrieValue,
  distinctMoves,
  finish,
  isCastle,
  lastTrack,
  legalMoves,
  LudoError,
  newGame,
  protectedSquares,
  teamRanking,
  trackStart,
  type LudoState,
} from './index.js';

function position(state: LudoState, tokens: number[][], current = 0, freeExit = [false, false, false, false]): LudoState {
  return { ...state, tokens, current, phase: 'roll', roll: null, sixesInRow: 0, bonus: [], extraRoll: false, lastMoved: null, freeExit };
}

/** Progression, pour la maison `home`, de la case absolue `square` de la piste. */
function prog(home: number, square: number): number {
  return (((square - 17 * home) % 68) + 68) % 68 + 7;
}

const B = BASE;
const game = (): LudoState => newGame({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] });

describe('Pachisi : plateau traditionnel', () => {
  it('descente privée de 7 cases, 68 cases de piste, remontée de 7, Charkoni à 82', () => {
    const c = game().config;
    expect(trackStart(c)).toBe(7);
    expect(lastTrack(c)).toBe(74);
    expect(finish(c)).toBe(82);
    for (const p of [0, 3, 6, 75, 81]) expect(absoluteSquare(c, 1, p)).toBeNull();
    // Bout de la branche, puis le tour complet jusqu'à la case voisine.
    expect(absoluteSquare(c, 1, 7)).toBe(17);
    expect(absoluteSquare(c, 1, 74)).toBe(16);
  });

  it('12 châteaux : le bout de chaque branche et la 4e case depuis le bout de chaque colonne extérieure', () => {
    const c = game().config;
    expect(protectedSquares(c)).toEqual([0, 4, 13, 17, 21, 30, 34, 38, 47, 51, 55, 64]);
    expect(isCastle(c, 21)).toBe(true);
    expect(isCastle(c, 22)).toBe(false);
  });

  it('équipes face à face obligatoires', () => {
    const g = game();
    expect(g.config.teams).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(g.freeExit).toEqual([true, true, true, true]);
  });
});

describe('Pachisi : lancer de cauris', () => {
  it('valeurs permises : 2 … 6, 10 et 25 (jamais 1)', () => {
    expect(() => applyRoll(game(), 1)).toThrow(LudoError);
    expect(() => applyRoll(game(), 7)).toThrow(LudoError);
    expect(() => applyRoll(game(), cowrieValue(0))).not.toThrow();
  });

  it('le premier pion sort avec n’importe quel lancer, les suivants seulement avec une grâce', () => {
    let g = applyRoll(game(), 3);
    expect(distinctMoves(legalMoves(g))).toEqual([{ seat: 0, token: 0, from: BASE, to: 0, captures: [] }]);
    g = applyMove(g, { token: 0 });
    expect(g.freeExit[0]).toBe(false);
    // 3 n'est pas une grâce : la main passe.
    expect(g.current).toBe(1);
    // Plus tard, un 3 ne sort plus de pion.
    g = applyRoll(position(g, g.tokens, 0, g.freeExit), 3);
    expect(legalMoves(g).every((m) => m.from !== BASE)).toBe(true);
  });

  it('une grâce (6, 10, 25) sort un pion et donne un lancer de plus', () => {
    for (const grace of [6, 10, 25]) {
      let g = position(game(), [[20, B, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]);
      g = applyRoll(g, grace);
      expect(legalMoves(g).some((m) => m.from === BASE)).toBe(true);
      g = applyMove(g, legalMoves(g).find((m) => m.from === BASE)!);
      expect(g.tokens[0]!.filter((p) => p === 0)).toHaveLength(1);
      expect(g.current).toBe(0);
      expect(g.phase).toBe('roll');
    }
  });

  it('une grâce qui ne peut pas être jouée relance quand même', () => {
    // Un seul pion en jeu, à 4 cases du Charkoni, les autres rentrés : le 25 ne se joue pas, mais la grâce relance.
    let g = position(game(), [[78, 82, 82, 82], [B, B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 25);
    expect(g.phase).toBe('roll');
    expect(g.current).toBe(0);
  });
});

describe('Pachisi : captures et châteaux', () => {
  it('une capture renvoie le pion et donne un lancer de plus', () => {
    // Maison 0 en case 3, maison 1 en case 5 (pas un château).
    let g = position(game(), [[prog(0, 3), B, B, B], [prog(1, 5), B, B, B], [B, B, B, B], [B, B, B, B]]);
    g = applyRoll(g, 2);
    expect(legalMoves(g)[0]!.captures).toEqual([{ seat: 1, token: 0 }]);
    g = applyMove(g, { token: 0 });
    expect(g.tokens[1]![0]).toBe(BASE);
    expect(g.current).toBe(0);
    expect(g.phase).toBe('roll');
  });

  it('un château occupé par un adversaire est fermé ; un partenaire peut s’y poser', () => {
    const tokens = [[prog(0, 2), B, B, B], [prog(1, 4), B, B, B], [B, B, B, B], [B, B, B, B]];
    let g = applyRoll(position(game(), tokens), 2);
    expect(legalMoves(g)).toEqual([]);
    const withPartner = [[prog(0, 2), B, B, B], [B, B, B, B], [prog(2, 4), B, B, B], [B, B, B, B]];
    g = applyRoll(position(game(), withPartner), 2);
    expect(legalMoves(g)[0]!.captures).toEqual([]);
  });

  it('barrière sur un château : on ne passe pas ; deux pions hors château ne bloquent pas et sont pris ensemble', () => {
    const castle = [[prog(0, 2), B, B, B], [prog(1, 4), prog(1, 4), B, B], [B, B, B, B], [B, B, B, B]];
    expect(legalMoves(applyRoll(position(game(), castle), 3))).toEqual([]);
    const open = [[prog(0, 3), B, B, B], [prog(1, 5), prog(1, 5), B, B], [B, B, B, B], [B, B, B, B]];
    expect(legalMoves(applyRoll(position(game(), open), 3))).toHaveLength(1);
    expect(legalMoves(applyRoll(position(game(), open), 2))[0]!.captures).toHaveLength(2);
  });
});

describe('Pachisi : arrivée', () => {
  it('chiffre exact pour entrer au Charkoni ; personne ne s’arrête à une case de l’arrivée (il faudrait un 1)', () => {
    let g = applyRoll(position(game(), [[57, B, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]), 25);
    expect(legalMoves(g)[0]!.to).toBe(82);
    g = applyRoll(position(game(), [[79, 20, B, B], [B, B, B, B], [B, B, B, B], [B, B, B, B]]), 2);
    expect(legalMoves(g).map((m) => m.from)).toEqual([20]);
  });

  it('qui a tout rentré joue les pions de son partenaire ; l’équipe gagne avec ses 8 pions', () => {
    let g = position(game(), [[82, 82, 82, 78], [20, B, B, B], [76, 82, 82, 82], [30, B, B, B]]);
    g = applyMove(applyRoll(g, 4), { token: 3 });
    expect(g.seats[0]!.status).toBe('finished');
    expect(controlledSeats(g, 0)).toEqual([2]);
    // 4 n'est pas une grâce : la main passe au siège 1.
    expect(g.current).toBe(1);
    g = position(g, g.tokens, 0, g.freeExit);
    g = applyRoll(g, 6);
    expect(legalMoves(g)).toEqual([{ seat: 2, token: 0, from: 76, to: 82, captures: [] }]);
    g = applyMove(g, { token: 0, seat: 2 });
    expect(g.phase).toBe('over');
    expect(teamRanking(g)).toEqual([0, 1]);
  });
});
