import { applyRoll, boardGeometry, finish, legalMoves, newGame, PRESET_IDS, type BoardShape } from '@kwatt/rules-ludo';
import { describe, expect, it } from 'vitest';
import fr from '../../i18n/locales/fr/ludo.json';
import { cellViews, centerTriangles, hitRadius, stackOffsets, tokenViews } from './board/layout';
import { rollDie, shellsForValue, throwCowries } from './local/dice';
import { MECHANIC_ROWS, mechanicLines, ruleValueKey, summaryKeys } from './mechanics';
import { statusMessage } from './messages';
import {
  changePreset,
  clampMachines,
  gameOptions,
  isRankedSetup,
  levelFromRating,
  machineCounts,
  presetOfVariant,
  ruleChoices,
  sanitizeSetup,
  variantId,
  withRule,
} from './setup';

/** Lit une clé « a.b.c » du catalogue français du Ludo. */
function has(key: string): boolean {
  let node: unknown = fr;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

describe('mise en place', () => {
  it('variantes du serveur', () => {
    expect(variantId('six')).toBe('ludo_six');
    expect(presetOfVariant('ludo_pachisi')).toBe('pachisi');
    expect(presetOfVariant('dames10')).toBeNull();
  });

  it('nombre de machines : 1 à 3, Pachisi toujours 3 (équipes)', () => {
    expect(machineCounts('classique')).toEqual([1, 2, 3]);
    expect(machineCounts('six')).toEqual([1, 2, 3]);
    expect(machineCounts('pachisi')).toEqual([3]);
    expect(clampMachines('pachisi', 1)).toBe(3);
    expect(gameOptions({ preset: 'pachisi', house: null }, 1)).toEqual({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]], house: null });
    expect(gameOptions({ preset: 'classique', house: null }, 2).players).toBe(3);
  });

  it('classée seulement sans règles maison, et pas au Parchís ni au Pachisi', () => {
    expect(isRankedSetup({ preset: 'classique', house: null })).toBe(true);
    expect(isRankedSetup({ preset: 'classique', house: { capture: 'home_roll_again' } })).toBe(false);
    expect(isRankedSetup({ preset: 'parchis', house: null })).toBe(false);
  });

  it('les combinaisons bloquées sont signalées avec le code des règles', () => {
    const choices = ruleChoices({ preset: 'classique', house: null }, 'barriers');
    expect(choices.map((c) => c.value)).toEqual(['none', 'any', 'six_opens']);
    expect(choices.find((c) => c.value === 'any')?.blocked?.code).toBe('ludo.setup.barrier_lock');
    expect(choices.find((c) => c.value === 'six_opens')?.blocked).toBeNull();
    // Avec la sortie au 6 ou au 1, les barrières libres redeviennent possibles.
    const house = withRule({ preset: 'classique', house: null }, 'exit', 'six_or_one');
    expect(ruleChoices({ preset: 'classique', house }, 'barriers').find((c) => c.value === 'any')?.blocked).toBeNull();
  });

  it('revenir à la valeur officielle retire le réglage maison', () => {
    const house = withRule({ preset: 'classique', house: { capture: 'home_bonus20' } }, 'capture', 'home');
    expect(house).toBeNull();
  });

  it('changer de plateau retire les règles maison qui n’y valent plus', () => {
    const s = changePreset({ preset: 'classique', house: { exit: 'six_or_one' }, houseSet: { id: 'x', name: 'Tata' } }, 'pachisi');
    expect(s).toEqual({ preset: 'pachisi', house: null, houseSet: null });
    const kept = changePreset({ preset: 'classique', house: { capture: 'home_roll_again' }, houseSet: null }, 'six');
    expect(kept.house).toEqual({ capture: 'home_roll_again' });
  });

  it('lecture tolérante de la variante gardée', () => {
    expect(sanitizeSetup(null)).toEqual({ preset: 'classique', house: null, houseSet: null });
    expect(sanitizeSetup({ preset: 'six', house: { barriers: 'any' } })).toEqual({ preset: 'six', house: null, houseSet: null });
    expect(sanitizeSetup({ preset: 'parchis', house: { capture: 'home' }, houseSet: { id: 'a', name: 'B' } })).toEqual({
      preset: 'parchis',
      house: { capture: 'home' },
      houseSet: { id: 'a', name: 'B' },
    });
  });

  it('niveau d’une force', () => {
    expect(levelFromRating(900)).toBe(2);
    expect(levelFromRating(1520)).toBe(18);
    expect(levelFromRating(700)).toBe(1);
  });
});

describe('tableau des mécanismes et résumé', () => {
  it.each(PRESET_IDS)('%s : 7 lignes, toutes traduites', (preset) => {
    const lines = mechanicLines({ preset, house: null });
    expect(lines.map((l) => l.row)).toEqual(MECHANIC_ROWS);
    for (const l of lines) expect(has(l.valueKey), l.valueKey).toBe(true);
    for (const k of summaryKeys({ preset, house: null })) expect(has(k), k).toBe(true);
    expect(lines.filter((l) => l.editable)).toHaveLength(4);
  });

  it('Pachisi : 6 cauris, l’équipe rentre ses 8 pions ; Parchís : trois 6 = pion renvoyé', () => {
    const pachisi = mechanicLines({ preset: 'pachisi', house: null });
    expect(pachisi.find((l) => l.row === 'throw')?.valueKey).toBe('mech.throw.cowries');
    expect(pachisi.find((l) => l.row === 'victory')).toMatchObject({ valueKey: 'mech.victory.team', params: { count: 8 } });
    expect(mechanicLines({ preset: 'parchis', house: null }).find((l) => l.row === 'throw')?.valueKey).toBe('mech.throw.dice_third_six');
    expect(mechanicLines({ preset: 'rapide', house: null }).find((l) => l.row === 'victory')?.params).toEqual({ count: 2 });
  });

  it('toutes les valeurs de règles maison sont traduites', () => {
    for (const preset of PRESET_IDS) {
      for (const rule of ['exit', 'capture', 'protection', 'barriers'] as const) {
        for (const c of ruleChoices({ preset, house: null }, rule)) expect(has(ruleValueKey(rule, c.value)), `${preset} ${rule} ${c.value}`).toBe(true);
      }
    }
  });

  it('les réglages maison changés sont marqués', () => {
    const lines = mechanicLines({ preset: 'classique', house: { capture: 'home_bonus20' } });
    expect(lines.find((l) => l.row === 'capture')).toMatchObject({ valueKey: 'mech.capture.home_bonus20', changed: true });
    expect(lines.find((l) => l.row === 'exit')?.changed).toBe(false);
  });
});

describe('message de la partie', () => {
  const seats = [
    { seat: 0, userId: null, name: 'Brice' },
    { seat: 1, userId: null, name: 'Machine 1', machine: { difficulty: 'moyen' } },
  ];

  it('à toi de lancer, puis « Un 6. Touche le pion à jouer. »', () => {
    const s = newGame({ preset: 'classique', players: 2 });
    expect(statusMessage({ state: s, mySeats: [0], seats, autoPlaySingleMove: true }).bold.key).toBe('msg.yourTurn');
    const rolled = applyRoll(s, 6);
    const m = statusMessage({ state: rolled, mySeats: [0], seats, autoPlaySingleMove: true, last: { kind: 'roll', seat: 0, params: { value: 6, playable: 1 } } });
    // Avec un seul coup distinct (les 4 pions à la maison), il est joué pour toi.
    expect(m.bold).toEqual({ key: 'msg.rolled', params: { count: 6 } });
    expect(m.text?.key).toBe('msg.singleMove');
    expect(m.auto).toBe(true);
    const manual = statusMessage({ state: rolled, mySeats: [0], seats, autoPlaySingleMove: false });
    expect(manual.text?.key).toBe('msg.touchToken');
  });

  it('lancer sans coup : « Un 2. Aucun pion ne peut bouger. »', () => {
    const s = applyRoll(newGame({ preset: 'classique', players: 2 }), 2);
    expect(s.current).toBe(1);
    const m = statusMessage({ state: s, mySeats: [0], seats, autoPlaySingleMove: true, last: { kind: 'roll', seat: 0, params: { value: 2, playable: 0 } } });
    expect(m.bold).toEqual({ key: 'msg.rolled', params: { count: 2 } });
    expect(m.text?.key).toBe('msg.noMove');
  });

  it('tour de la machine, joueur absent, spectateur', () => {
    const s = applyRoll(newGame({ preset: 'classique', players: 2 }), 2);
    expect(statusMessage({ state: s, mySeats: [0], seats, autoPlaySingleMove: true }).bold).toEqual({ key: 'msg.theirTurn', params: { name: 'Machine 1' } });
    const away = [seats[0]!, { ...seats[1]!, connected: false }];
    expect(statusMessage({ state: s, mySeats: [0], seats: away, autoPlaySingleMove: true }).bold.key).toBe('msg.away');
    expect(statusMessage({ state: s, mySeats: [], seats, autoPlaySingleMove: true }).bold.key).toBe('msg.turnOf');
  });

  it('en équipe, le partenaire est rappelé', () => {
    const s = applyRoll(newGame({ preset: 'classique', players: 4, teams: [[0, 2], [1, 3]] }), 6);
    const four = [0, 1, 2, 3].map((seat) => ({ seat, userId: null, name: `J${seat}` }));
    expect(statusMessage({ state: s, mySeats: [0], seats: four, autoPlaySingleMove: false }).text).toEqual({ key: 'msg.partner', params: { name: 'J2' } });
  });

  it('toutes les clés de message existent', () => {
    for (const k of ['over', 'yourTurn', 'rollDice', 'throwCowries', 'rollAgain', 'throwAgain', 'rolled', 'bonus', 'touchToken', 'singleMove', 'autoPlayedTitle', 'partner', 'theirTurn', 'theyRolled', 'theyThrew', 'away', 'machinePlays', 'turnOf', 'noMove', 'noMoveAgain']) {
      expect(has(`msg.${k}`), k).toBe(true);
    }
  });
});

describe('dessin du plateau', () => {
  const shapes: BoardShape[] = ['croix', 'etoile', 'parchis', 'pachisi'];

  it.each(shapes)('%s : chaque case une seule fois, dans le plateau', (board) => {
    const preset = board === 'croix' ? 'classique' : board === 'etoile' ? 'six' : board;
    const s = newGame(preset === 'pachisi' ? { preset, players: 4, teams: [[0, 2], [1, 3]] } : { preset, players: 4 });
    const g = boardGeometry(board);
    const cells = cellViews(s.config, g);
    const expected = g.track.length + g.corridors.flat().length + (board === 'pachisi' ? 0 : g.lanes.flat().length);
    expect(cells.length).toBe(expected);
    for (const c of cells) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(g.size);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(g.size);
    }
    // Départs colorés, une couleur par maison.
    expect(new Set(cells.filter((c) => c.key.startsWith('t') && c.home !== null).map((c) => c.home)).size).toBe(g.homes);
    expect(centerTriangles(g)).toHaveLength(g.homes);
  });

  it('marques : étoiles protégées, cases sûres du Parchís, châteaux du Pachisi', () => {
    const classic = newGame({ preset: 'classique', players: 2 });
    expect(cellViews(classic.config, boardGeometry('croix')).filter((c) => c.mark === 'star')).toHaveLength(4);
    const quick = newGame({ preset: 'rapide', players: 2 });
    expect(cellViews(quick.config, boardGeometry('croix')).filter((c) => c.mark === 'star')).toHaveLength(0);
    const parchis = newGame({ preset: 'parchis', players: 2 });
    expect(cellViews(parchis.config, boardGeometry('parchis')).filter((c) => c.mark === 'safe')).toHaveLength(8);
    const pachisi = newGame({ preset: 'pachisi', players: 4, teams: [[0, 2], [1, 3]] });
    expect(cellViews(pachisi.config, boardGeometry('pachisi')).filter((c) => c.mark === 'castle')).toHaveLength(12);
  });

  it('pions : à la base, sur la piste, en pile, jouables au-dessus', () => {
    let s = applyRoll(newGame({ preset: 'classique', players: 2 }), 6);
    const g = boardGeometry('croix');
    const moves = legalMoves(s);
    const views = tokenViews(s, g, new Set(moves.map((m) => `${m.seat}:${m.token}`)), finish(s.config));
    expect(views).toHaveLength(8);
    expect(views.every((v) => v.atBase)).toBe(true);
    expect(views.slice(-4).every((v) => v.playable && v.seat === 0)).toBe(true);
    // Deux pions sur la même case : décalés.
    s = { ...s, tokens: [[0, 0, -1, -1], [-1, -1, -1, -1]] };
    const stacked = tokenViews(s, g, new Set(), finish(s.config)).filter((v) => !v.atBase);
    expect(stacked).toHaveLength(2);
    expect(stacked[0]!.x).not.toBe(stacked[1]!.x);
    expect(stackOffsets(4)).toHaveLength(4);
  });

  it('zone tactile d’au moins 48 px', () => {
    expect(hitRadius(24) * 24 * 2).toBeGreaterThanOrEqual(48);
    expect(hitRadius(19) * 19 * 2).toBeGreaterThanOrEqual(48);
  });
});

describe('lancers sur l’appareil', () => {
  it('dé sans biais : les octets ≥ 252 sont rejetés', () => {
    const bytes = [255, 252, 5];
    expect(rollDie(() => new Uint8Array([bytes.shift()!]))).toBe(6);
  });

  it('cauris : la valeur suit le nombre d’ouvertures', () => {
    expect(throwCowries(() => new Uint8Array([0])).value).toBe(25);
    expect(throwCowries(() => new Uint8Array([1])).value).toBe(10);
    expect(throwCowries(() => new Uint8Array([0b111111])).value).toBe(6);
    expect(throwCowries(() => new Uint8Array([0b000011])).shells).toEqual([true, true, false, false, false, false]);
    expect(shellsForValue(25).filter(Boolean)).toHaveLength(0);
    expect(shellsForValue(4).filter(Boolean)).toHaveLength(4);
  });
});
