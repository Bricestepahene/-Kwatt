import { describe, expect, it } from 'vitest';
import {
  COWRIE_VALUES,
  cowrieValue,
  houseRuleOptions,
  isGrace,
  isRanked,
  LUDO_ERRORS,
  LudoError,
  newGame,
  normalizeHouseRules,
  PRESET_IDS,
  PRESETS,
  throwDistribution,
  validateSetup,
  type NewGameOptions,
} from './index.js';

/** Code d'erreur levé par newGame (ou null). */
function setupError(options: NewGameOptions): string | null {
  try {
    newGame(options);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(LudoError);
    return (e as LudoError).code;
  }
}

describe('les 5 variantes de la planche', () => {
  it('plateau, joueurs, pions, sortie, lancer, capture, protection, barrières, équipes, classement', () => {
    const rows = PRESET_IDS.map((id) => {
      const p = PRESETS[id];
      const m = p.mechanics;
      return [id, p.board, p.players.join('-'), m.tokensPerPlayer, m.exit, m.throw, m.capture, m.safeSquares, m.barriers, p.teamSizes.join('/'), p.teamsRequired, p.ranked];
    });
    expect(rows).toEqual([
      ['classique', 'croix', '2-4', 4, 'six', 'dice', 'home', 'etoiles_departs', 'none', '2', false, true],
      ['rapide', 'croix', '2-4', 2, 'six_or_one', 'dice', 'home_roll_again', 'departs', 'none', '', false, true],
      ['six', 'etoile', '2-6', 4, 'six', 'dice', 'home', 'etoiles_departs', 'none', '2/3', false, true],
      ['parchis', 'parchis', '2-4', 4, 'five', 'dice', 'home_bonus20', 'sures', 'six_opens', '2', false, false],
      ['pachisi', 'pachisi', '4-4', 4, 'grace', 'cowries', 'home_roll_again', 'chateaux', 'castles', '2', true, false],
    ]);
    expect(PRESETS.rapide.timeLimitMs).toBe(600_000);
    expect(PRESETS.parchis.mechanics).toMatchObject({ captureBonus: 20, homeBonus: 10, thirdSix: 'last_moved_home', exitForced: true, exitRolls: [5] });
    expect(PRESETS.pachisi.mechanics).toMatchObject({ firstExitFree: true, graceRollsAgain: true, captureGivesRoll: true, exitRolls: [6, 10, 25], safeShared: false });
  });

  it('cauris : 0 ouverture = 25, 1 = 10, 2 à 6 = la valeur ; grâces 6, 10, 25', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(cowrieValue)).toEqual([25, 10, 2, 3, 4, 5, 6]);
    expect(COWRIE_VALUES.filter(isGrace)).toEqual([25, 10, 6]);
    expect(() => cowrieValue(7)).toThrow(LudoError);
  });

  it('loi exacte des lancers : dé uniforme, cauris binomiaux', () => {
    for (const kind of ['dice', 'cowries'] as const) {
      const total = throwDistribution(kind).reduce((s, x) => s + x.p, 0);
      expect(total).toBeCloseTo(1, 12);
    }
    const c = new Map(throwDistribution('cowries').map((x) => [x.value, x.p]));
    expect(c.get(25)).toBe(1 / 64);
    expect(c.get(10)).toBe(6 / 64);
    expect(c.get(3)).toBe(20 / 64);
    expect(c.get(4)).toBe(15 / 64);
    // Une grâce sur 8 lancers.
    expect([6, 10, 25].reduce((s, v) => s + c.get(v)!, 0)).toBe(8 / 64);
  });
});

describe('combinaisons bloquées : refusées par un code d’erreur', () => {
  it('plateau à 6 branches avec les règles du Parchís ou du Pachisi', () => {
    expect(setupError({ preset: 'parchis', players: 4, board: 'etoile' })).toBe('ludo.setup.board_incompatible');
    expect(setupError({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]], board: 'etoile' })).toBe('ludo.setup.board_incompatible');
    expect(setupError({ preset: 'parchis', players: 4, board: 'parchis' })).toBeNull();
  });

  it('Pachisi sans équipes, ou à un nombre de joueurs autre que 4', () => {
    expect(setupError({ preset: 'pachisi', players: 4 })).toBe('ludo.setup.pachisi_teams');
    expect(setupError({ preset: 'pachisi', players: 2 })).toBe('ludo.setup.pachisi_players');
    expect(setupError({ preset: 'pachisi', players: 6, teams: [[0, 3], [1, 4], [2, 5]] })).toBe('ludo.setup.pachisi_players');
    expect(setupError({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] })).toBeNull();
  });

  it('un dé quand le Pachisi lance des cauris, et l’inverse', () => {
    expect(setupError({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]], throw: 'dice' })).toBe('ludo.setup.throw_incompatible');
    expect(setupError({ preset: 'classique', players: 2, throw: 'cowries' })).toBe('ludo.setup.throw_incompatible');
    expect(setupError({ preset: 'classique', players: 2, house: { exit: 'grace' } })).toBe('ludo.setup.throw_incompatible');
    expect(setupError({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]], house: { exit: 'six' } })).toBe('ludo.setup.throw_incompatible');
  });

  it('barrières avec « sortie seulement au 6 » sans « un 6 ouvre la barrière »', () => {
    expect(setupError({ preset: 'classique', players: 2, house: { barriers: 'any' } })).toBe('ludo.setup.barrier_lock');
    expect(setupError({ preset: 'parchis', players: 2, house: { exit: 'six', barriers: 'any' } })).toBe('ludo.setup.barrier_lock');
    // Avec « un 6 ouvre », ou une autre sortie, c'est permis.
    expect(setupError({ preset: 'classique', players: 2, house: { barriers: 'six_opens' } })).toBeNull();
    expect(setupError({ preset: 'classique', players: 2, house: { barriers: 'any', exit: 'six_or_one' } })).toBeNull();
    expect(setupError({ preset: 'parchis', players: 2, house: { exit: 'six' } })).toBeNull();
  });

  it('équipes avec un nombre de joueurs impair', () => {
    expect(setupError({ preset: 'six', players: 5, teams: [[0, 1], [2, 3]] })).toBe('ludo.setup.teams_odd');
    expect(setupError({ preset: 'classique', players: 3, teams: [[0, 1], [2]] })).toBe('ludo.setup.teams_odd');
  });

  it('équipes : pas en Rapide, taille permise, partition des sièges, partenaires face à face', () => {
    expect(setupError({ preset: 'rapide', players: 4, teams: [[0, 2], [1, 3]] })).toBe('ludo.setup.teams_not_allowed');
    expect(setupError({ preset: 'classique', players: 4, teams: [[0, 1, 2, 3]] })).toBe('ludo.setup.teams_size');
    expect(setupError({ preset: 'classique', players: 4, teams: [[0, 2], [1, 2]] })).toBe('ludo.setup.teams_partition');
    expect(setupError({ preset: 'classique', players: 2, teams: [[0, 1]] })).toBe('ludo.setup.teams_partition');
    expect(setupError({ preset: 'classique', players: 4, teams: [[0, 1], [2, 3]] })).toBe('ludo.setup.teams_facing');
    expect(setupError({ preset: 'pachisi', players: 4, teams: [[0, 1], [2, 3]] })).toBe('ludo.setup.teams_facing');
    // Étoile : 3 équipes de 2 face à face, ou 2 équipes de 3 en alternance ; à 4 joueurs, maisons 0, 1, 3, 4.
    expect(setupError({ preset: 'six', players: 6, teams: [[0, 3], [1, 4], [2, 5]] })).toBeNull();
    expect(setupError({ preset: 'six', players: 6, teams: [[0, 2, 4], [1, 3, 5]] })).toBeNull();
    expect(setupError({ preset: 'six', players: 6, teams: [[0, 1, 2], [3, 4, 5]] })).toBe('ludo.setup.teams_facing');
    expect(setupError({ preset: 'six', players: 4, teams: [[0, 2], [1, 3]] })).toBeNull();
    expect(setupError({ preset: 'parchis', players: 4, teams: [[0, 2], [1, 3]] })).toBeNull();
  });

  it('nombre de joueurs et variante inconnue', () => {
    expect(setupError({ preset: 'classique', players: 5 })).toBe('ludo.setup.players');
    expect(setupError({ preset: 'parchis', players: 1 })).toBe('ludo.setup.players');
    expect(setupError({ preset: 'inconnu' as never, players: 2 })).toBe('ludo.setup.unknown_preset');
    const e = (() => {
      try {
        newGame({ preset: 'classique', players: 7 });
      } catch (err) {
        return err as LudoError;
      }
      return null;
    })();
    expect(e?.params).toEqual({ preset: 'classique', min: 2, max: 4 });
  });

  it('réglage maison hors des limites du plateau', () => {
    expect(setupError({ preset: 'classique', players: 2, house: { protection: 'sures' } })).toBe('ludo.setup.house_option');
    expect(setupError({ preset: 'classique', players: 2, house: { barriers: 'castles' } })).toBe('ludo.setup.house_option');
    expect(setupError({ preset: 'parchis', players: 2, house: { protection: 'etoiles_departs' } })).toBe('ludo.setup.house_option');
    expect(setupError({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]], house: { barriers: 'six_opens' } })).toBe('ludo.setup.house_option');
  });

  it('validateSetup répond sans lever d’erreur (pour griser une option dans l’appli)', () => {
    expect(validateSetup({ preset: 'pachisi', players: 4 })).toEqual({ ok: false, code: 'ludo.setup.pachisi_teams', params: {} });
    expect(validateSetup({ preset: 'six', players: 6 })).toEqual({ ok: true });
  });

  it('tous les codes levés sont déclarés', () => {
    for (const code of ['ludo.setup.board_incompatible', 'ludo.setup.barrier_lock', 'ludo.move.illegal', 'ludo.roll.invalid_value']) {
      expect(LUDO_ERRORS).toContain(code);
    }
  });
});

describe('règles maison', () => {
  it('les quatre réglages et leurs valeurs permises, la valeur officielle en tête', () => {
    expect(houseRuleOptions('classique')).toEqual([
      { rule: 'exit', options: ['six', 'six_or_one', 'five'], default: 'six' },
      { rule: 'capture', options: ['home', 'home_roll_again', 'home_bonus20'], default: 'home' },
      { rule: 'protection', options: ['etoiles_departs', 'departs'], default: 'etoiles_departs' },
      { rule: 'barriers', options: ['none', 'any', 'six_opens'], default: 'none' },
    ]);
    for (const id of PRESET_IDS) for (const o of houseRuleOptions(id)) expect(o.options).toContain(o.default);
  });

  it('une partie aux règles maison est amicale ; un réglage identique à l’officiel ne compte pas', () => {
    const official = newGame({ preset: 'classique', players: 2, house: { exit: 'six', barriers: 'none' } });
    expect(official.config.house).toBeNull();
    expect(isRanked(official.config)).toBe(true);
    const house = newGame({ preset: 'classique', players: 2, house: { exit: 'five', capture: 'home' } });
    expect(house.config.house).toEqual({ exit: 'five' });
    expect(isRanked(house.config)).toBe(false);
    expect(house.config.mechanics.exitRolls).toEqual([5]);
    expect(normalizeHouseRules('rapide', { protection: 'departs' })).toBeNull();
  });

  it('Parchís et Pachisi sont toujours amicaux ; Classique, Rapide et 6 joueurs sont classés', () => {
    expect(isRanked(newGame({ preset: 'parchis', players: 4 }).config)).toBe(false);
    expect(isRanked(newGame({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] }).config)).toBe(false);
    expect(isRanked(newGame({ preset: 'six', players: 5 }).config)).toBe(true);
    expect(isRanked(newGame({ preset: 'rapide', players: 3 }).config)).toBe(true);
  });

  it('la capture « + 20 » change aussi les mécanismes dérivés', () => {
    const g = newGame({ preset: 'rapide', players: 2, house: { capture: 'home_bonus20' } });
    expect(g.config.mechanics).toMatchObject({ captureGivesRoll: false, captureBonus: 20 });
  });
});
