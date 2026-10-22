import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyRoll,
  BASE,
  endOnTime,
  legalMoves,
  newGame,
  progressStandings,
  removeSeat,
  type HouseRules,
  type LudoState,
} from './index.js';

function position(state: LudoState, tokens: number[][], current = 0): LudoState {
  return { ...state, tokens, current, phase: 'roll', roll: null, sixesInRow: 0, bonus: [], extraRoll: false, lastMoved: null };
}

/** Classique à 2 : sièges en maisons 0 et 2 ; progression de la maison 2 pour une case absolue. */
const p2 = (square: number): number => (square - 26 + 52) % 52;
const B = BASE;
const classic = (house: HouseRules): LudoState => newGame({ preset: 'classique', players: 2, house });

describe('règles maison sur la croix', () => {
  it('sortie avec un 5', () => {
    const g = applyRoll(classic({ exit: 'five' }), 5);
    expect(legalMoves(g).every((m) => m.from === BASE)).toBe(true);
    expect(applyRoll(classic({ exit: 'five' }), 6).current).toBe(0);
    // Le 6 rejoue toujours, même sans coup possible.
    expect(applyRoll(classic({ exit: 'five' }), 6).phase).toBe('roll');
  });

  it('sortie avec un 6 ou un 1', () => {
    const g = applyRoll(classic({ exit: 'six_or_one' }), 1);
    expect(legalMoves(g)).toHaveLength(4);
  });

  it('capture « renvoi + tu rejoues »', () => {
    let g = position(classic({ capture: 'home_roll_again' }), [[1, B, B, B], [p2(3), B, B, B]]);
    g = applyMove(applyRoll(g, 2), { token: 0 });
    expect(g.tokens[1]![0]).toBe(BASE);
    expect(g.current).toBe(0);
    expect(g.phase).toBe('roll');
  });

  it('capture « renvoi + avancer de 20 »', () => {
    let g = position(classic({ capture: 'home_bonus20' }), [[1, 10, B, B], [p2(3), B, B, B]]);
    g = applyMove(applyRoll(g, 2), { token: 0 });
    expect(g.bonus).toEqual([20]);
    g = applyMove(g, { token: 1 });
    expect(g.tokens[0]![1]).toBe(30);
    expect(g.current).toBe(1);
  });

  it('protection « départs seulement » : l’étoile ne protège plus', () => {
    const tokens = [[5, B, B, B], [p2(8), B, B, B]];
    expect(legalMoves(applyRoll(position(classic({}), tokens), 3))[0]!.captures).toEqual([]);
    expect(legalMoves(applyRoll(position(classic({ protection: 'departs' }), tokens), 3))[0]!.captures).toEqual([{ seat: 1, token: 0 }]);
  });

  it('barrières autorisées : deux pions bloquent le passage, deux pions au plus par case', () => {
    const house: HouseRules = { barriers: 'six_opens' };
    // Barrière adverse en case 10.
    const tokens = [[7, B, B, B], [p2(10), p2(10), B, B]];
    expect(legalMoves(applyRoll(position(classic(house), tokens), 2))).toHaveLength(1);
    expect(applyRoll(position(classic(house), tokens), 3).current).toBe(1);
    expect(applyRoll(position(classic(house), tokens), 5).current).toBe(1);
    // Sans barrières (officiel), on passe et on prend les deux.
    const m = legalMoves(applyRoll(position(classic({}), tokens), 3));
    expect(m[0]!.captures).toHaveLength(2);
  });

  it('barrière sur son propre départ : le 6 oblige à l’ouvrir, l’adversaire bloqué peut ensuite sortir', () => {
    const house: HouseRules = { barriers: 'six_opens' };
    // Barrière du siège 0 sur le départ du siège 1 (case 26).
    let g = position(classic(house), [[26, 26, 3, B], [B, B, B, B]]);
    g = applyRoll(g, 6);
    expect(new Set(legalMoves(g).map((m) => m.from))).toEqual(new Set([26]));
    // Barrière laissée en place, le siège 1 sort en prenant un des deux pions (départ plein).
    g = applyRoll(position(classic(house), [[26, 26, 3, B], [B, B, B, B]], 1), 6);
    const exit = legalMoves(g).find((m) => m.from === BASE)!;
    expect(exit.captures).toEqual([{ seat: 0, token: 0 }]);
  });

  it('les règles maison s’appliquent aussi à l’étoile et au Rapide', () => {
    const six = newGame({ preset: 'six', players: 6, house: { protection: 'departs' } });
    expect(six.config.mechanics.safeSquares).toBe('departs');
    const r = newGame({ preset: 'rapide', players: 2, house: { exit: 'six' } });
    expect(r.config.mechanics.exitRolls).toEqual([6]);
  });
});

describe('fin au temps (Rapide, 10 min) : classement à la progression', () => {
  it('les arrivés d’abord, puis la progression, puis les sortis', () => {
    let g = newGame({ preset: 'rapide', players: 4 });
    g = { ...position(g, [[56, 56], [30, 10], [50, B], [20, 20]]), seats: g.seats.map((s, i) => (i === 0 ? { ...s, status: 'finished' as const } : s)), ranking: [0] };
    g = removeSeat(g, 3);
    const end = endOnTime(g);
    expect(end.phase).toBe('over');
    // Siège 1 : 31 + 11 = 42 ; siège 2 : 51 + 0 = 51.
    expect(end.ranking).toEqual([0, 2, 1, 3]);
    const st = progressStandings(g);
    expect(st.map((s) => [s.seat, s.place, s.progress, s.tokensHome])).toEqual([
      [0, 1, 114, 2],
      [2, 2, 51, 0],
      [1, 3, 42, 0],
      [3, 4, 42, 0],
    ]);
    expect(st[0]!.ratio).toBe(1);
    expect(endOnTime(end)).toBe(end);
  });

  it('égalité de progression : plus de pions rentrés, puis le pion le plus avancé, puis l’ordre des sièges', () => {
    const g = position(newGame({ preset: 'rapide', players: 3 }), [[10, 10], [20, B], [56, B]]);
    // Totaux : 22, 21, 57 → siège 2, siège 0, siège 1.
    expect(endOnTime(g).ranking).toEqual([2, 0, 1]);
    const tie = position(newGame({ preset: 'rapide', players: 3 }), [[9, 9], [B, 19], [19, B]]);
    // Totaux égaux (20) : le pion le plus avancé (19) devant, puis l'ordre des sièges.
    expect(endOnTime(tie).ranking).toEqual([1, 2, 0]);
  });

  it('la durée du Rapide est dans la configuration', () => {
    expect(newGame({ preset: 'rapide', players: 2 }).config.timeLimitMs).toBe(600_000);
    expect(newGame({ preset: 'classique', players: 2 }).config.timeLimitMs).toBeNull();
  });
});
