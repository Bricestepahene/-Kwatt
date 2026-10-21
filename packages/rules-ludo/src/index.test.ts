import { describe, expect, it } from 'vitest';
import {
  absoluteSquare,
  applyMove,
  applyRoll,
  BASE,
  distinctMoves,
  finish,
  isSafeSquare,
  lastTrack,
  legalMoves,
  LudoError,
  newGame,
  presetForPlayers,
  removeSeat,
  teamRanking,
  type LudoState,
} from './index.js';

/** Place des pions à la main (les tests partent d'une position précise). */
function withTokens(state: LudoState, tokens: number[][], current = 0): LudoState {
  return { ...state, tokens, current, phase: 'roll', roll: null, sixesInRow: 0 };
}

describe('plateau', () => {
  it('croix : 52 cases, couloir de 5, arrivée à 56', () => {
    const g = newGame({ preset: 'classique', players: 4 });
    expect(lastTrack(g.config)).toBe(50);
    expect(finish(g.config)).toBe(56);
    expect(absoluteSquare(g.config, 1, 0)).toBe(13);
    expect(absoluteSquare(g.config, 3, 50)).toBe((39 + 50) % 52);
    expect(absoluteSquare(g.config, 0, 51)).toBeNull();
  });

  it('étoile : 78 cases', () => {
    const g = newGame({ preset: 'six', players: 6 });
    expect(lastTrack(g.config)).toBe(76);
    expect(finish(g.config)).toBe(82);
  });

  it('départs et étoiles protègent ; en rapide, seulement les départs', () => {
    const c = newGame({ preset: 'classique', players: 4 }).config;
    expect(isSafeSquare(c, 0)).toBe(true);
    expect(isSafeSquare(c, 8)).toBe(true);
    expect(isSafeSquare(c, 21)).toBe(true);
    expect(isSafeSquare(c, 5)).toBe(false);
    const r = newGame({ preset: 'rapide', players: 2 }).config;
    expect(isSafeSquare(r, 8)).toBe(false);
  });

  it('nombre de joueurs : croix 2 à 4, étoile 2 à 6', () => {
    expect(() => newGame({ preset: 'classique', players: 5 })).toThrow(LudoError);
    expect(newGame({ preset: 'six', players: 5 }).seats.map((s) => s.home)).toEqual([0, 1, 2, 3, 4]);
    expect(newGame({ preset: 'classique', players: 2 }).seats.map((s) => s.home)).toEqual([0, 2]);
    expect(presetForPlayers(4)).toBe('classique');
    expect(presetForPlayers(6)).toBe('six');
  });

  it('équipes : nombre impair refusé', () => {
    expect(() => newGame({ preset: 'six', players: 5, teams: [[0, 1], [2, 3]] })).toThrow(LudoError);
    expect(() => newGame({ preset: 'rapide', players: 4, teams: [[0, 2], [1, 3]] })).toThrow(LudoError);
  });
});

describe('déroulé d’un tour', () => {
  it('il faut un 6 pour sortir ; sans coup, le tour passe', () => {
    let g = newGame({ preset: 'classique', players: 2 });
    g = applyRoll(g, 4);
    expect(g.current).toBe(1);
    expect(g.phase).toBe('roll');
  });

  it('un 6 sort un pion et donne un lancer de plus', () => {
    let g = newGame({ preset: 'classique', players: 2 });
    g = applyRoll(g, 6);
    expect(legalMoves(g)).toHaveLength(4);
    expect(distinctMoves(legalMoves(g))).toHaveLength(1);
    g = applyMove(g, { token: 0 });
    expect(g.tokens[0]![0]).toBe(0);
    expect(g.current).toBe(0);
    expect(g.phase).toBe('roll');
  });

  it('trois 6 de suite : le tour passe sans jouer le troisième', () => {
    let g = withTokens(newGame({ preset: 'classique', players: 2 }), [[10, BASE, BASE, BASE], [BASE, BASE, BASE, BASE]]);
    g = applyMove(applyRoll(g, 6), { token: 0 });
    g = applyMove(applyRoll(g, 6), { token: 0 });
    const before = g.tokens;
    g = applyRoll(g, 6);
    expect(g.tokens).toEqual(before);
    expect(g.current).toBe(1);
  });

  it('tomber sur un adversaire le renvoie à sa maison', () => {
    // Siège 0 (maison 0) en progression 3 = case 3. Siège 1 (maison 2) : case 3 = progression 3 − 26 + 52 = 29.
    let g = withTokens(newGame({ preset: 'classique', players: 2 }), [[1, BASE, BASE, BASE], [29, BASE, BASE, BASE]]);
    g = applyRoll(g, 2);
    const [m] = legalMoves(g);
    expect(m!.captures).toEqual([{ seat: 1, token: 0 }]);
    g = applyMove(g, { token: 0 });
    expect(g.tokens[1]![0]).toBe(BASE);
    // Classique : pas de lancer de plus après une capture.
    expect(g.current).toBe(1);
  });

  it('en rapide, une capture donne un lancer de plus ; on sort aussi avec un 1', () => {
    let g = withTokens(newGame({ preset: 'rapide', players: 2 }), [[1, BASE], [29, BASE]]);
    g = applyMove(applyRoll(g, 2), { token: 0 });
    expect(g.current).toBe(0);
    g = applyRoll(g, 1);
    expect(legalMoves(g).some((m) => m.from === BASE)).toBe(true);
  });

  it('pas de capture sur une case protégée', () => {
    // Case 8 = étoile. Siège 1 (maison 2) : progression 8 − 26 + 52 = 34.
    let g = withTokens(newGame({ preset: 'classique', players: 2 }), [[5, BASE, BASE, BASE], [34, BASE, BASE, BASE]]);
    g = applyRoll(g, 3);
    expect(legalMoves(g)[0]!.captures).toEqual([]);
  });

  it('il faut le chiffre exact pour rentrer', () => {
    let g = withTokens(newGame({ preset: 'classique', players: 2 }), [[54, BASE, BASE, BASE], [BASE, BASE, BASE, BASE]]);
    g = applyRoll(g, 3);
    expect(g.current).toBe(1);
    g = withTokens(g, [[54, BASE, BASE, BASE], [BASE, BASE, BASE, BASE]]);
    g = applyMove(applyRoll(g, 2), { token: 0 });
    expect(g.tokens[0]![0]).toBe(56);
  });

  it('le premier à rentrer ses pions gagne ; la partie s’arrête quand il reste un joueur', () => {
    let g = withTokens(newGame({ preset: 'classique', players: 2 }), [[56, 56, 56, 55], [10, BASE, BASE, BASE]]);
    g = applyMove(applyRoll(g, 1), { token: 3 });
    expect(g.phase).toBe('over');
    expect(g.ranking).toEqual([0, 1]);
  });

  it('à 3, la partie continue après le premier arrivé', () => {
    let g = withTokens(newGame({ preset: 'classique', players: 3 }), [[56, 56, 56, 55], [10, BASE, BASE, BASE], [20, BASE, BASE, BASE]]);
    g = applyMove(applyRoll(g, 1), { token: 3 });
    expect(g.phase).toBe('roll');
    expect(g.current).toBe(1);
    expect(g.ranking).toEqual([0]);
  });

  it('un joueur retiré quitte le plateau et finit dernier', () => {
    let g = newGame({ preset: 'classique', players: 3 });
    g = removeSeat(g, 0);
    expect(g.current).toBe(1);
    g = removeSeat(g, 2);
    expect(g.phase).toBe('over');
    expect(g.ranking).toEqual([1, 2, 0]);
  });

  it('en équipe, on ne mange jamais son partenaire', () => {
    // 4 joueurs : sièges 0 et 2 ensemble. Siège 2 (maison 2) en case 3 = progression 29.
    let g = newGame({ preset: 'classique', players: 4, teams: [[0, 2], [1, 3]] });
    g = withTokens(g, [[1, BASE, BASE, BASE], [BASE, BASE, BASE, BASE], [29, BASE, BASE, BASE], [BASE, BASE, BASE, BASE]]);
    g = applyRoll(g, 2);
    expect(legalMoves(g)[0]!.captures).toEqual([]);
  });

  it('le coup refusé est rejeté', () => {
    const g = applyRoll(newGame({ preset: 'classique', players: 2 }), 6);
    expect(() => applyMove(g, { token: 9 })).toThrow(LudoError);
    expect(() => applyRoll(g, 3)).toThrow(LudoError);
  });
});

describe('parties complètes avec des dés fixés', () => {
  function playout(players: number, preset: 'classique' | 'rapide' | 'six', seed: number, teams?: number[][]): LudoState {
    // mulberry32 : générateur de test, jamais utilisé pour de vraies parties.
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const die = (): number => Math.floor(next() * 6) + 1;
    let g = newGame(teams ? { preset, players, teams } : { preset, players });
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 20000) {
      g = applyRoll(g, die());
      if (g.phase === 'move') {
        const moves = legalMoves(g);
        g = applyMove(g, moves[Math.floor(next() * moves.length)]!);
      }
    }
    return g;
  }

  it.each([
    [2, 'classique'],
    [4, 'classique'],
    [3, 'rapide'],
    [5, 'six'],
    [6, 'six'],
  ] as const)('%i joueurs, %s : la partie se termine et tout le monde est classé', (players, preset) => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = playout(players, preset, seed);
      expect(g.phase).toBe('over');
      expect([...g.ranking].sort()).toEqual(Array.from({ length: players }, (_, i) => i));
    }
  });

  it('même graine, même partie', () => {
    expect(playout(4, 'classique', 7)).toEqual(playout(4, 'classique', 7));
  });

  it('équipes : la partie se termine et les équipes sont classées', () => {
    const g = playout(4, 'classique', 3, [[0, 2], [1, 3]]);
    expect(g.phase).toBe('over');
    expect(teamRanking(g)).toHaveLength(2);
  });
});
