import { describe, expect, it } from 'vitest';
import {
  addDays,
  boardChoices,
  boardColor,
  initialLineup,
  swapBoards,
  withTeams,
  championshipMatches,
  championshipRounds,
  clampStep,
  cupShapes,
  daysHours,
  defaultDraft,
  draftRequest,
  endOfKwattDay,
  hoursMinutes,
  knockoutStageKey,
  leagueCodeFrom,
  policiesOf,
  publicPreview,
  toggleBoard,
  withGame,
  withPolicy,
} from './logic';

const NOW = Date.parse('2026-11-01T08:00:00.000Z');

describe('brouillon de ligue', () => {
  it('ligue privée par défaut : championnat aller-retour, planche au choix de qui reçoit', () => {
    const d = defaultDraft('private', NOW);
    expect(d).toMatchObject({ access: 'private', format: 'championship', doubleRound: true, entry: 0, firstDay: '2026-11-02', rhythm: 'weekly' });
    expect(d.boardRules).toEqual({ policy: 'home', allowed: ['dames10', 'dames8'], defaultBoard: 'dames10' });
  });

  it('ligue publique par défaut : 16 places, entrée 200, inscriptions une semaine', () => {
    const d = defaultDraft('public', NOW);
    expect(d).toMatchObject({ maxPlaces: 16, entry: 200, closesDay: '2026-11-08', firstDay: '2026-11-11', rhythm: 'daily' });
    const body = draftRequest({ ...d, name: '  Ligue Littoral  ' });
    expect(body.name).toBe('Ligue Littoral');
    expect(body.registrationClosesAt).toBe('2026-11-08T22:59:00.000Z');
    expect(body).not.toHaveProperty('rounds');
    expect(body).not.toHaveProperty('groups');
  });

  it('coupe : poules envoyées, pas d’aller-retour de championnat', () => {
    const d = { ...defaultDraft('private', NOW), format: 'cup' as const, maxPlaces: 8 };
    expect(draftRequest(d)).toMatchObject({ format: 'cup', groups: 2, qualifiersPerGroup: 2, doubleRound: false });
  });

  it('Ludo : pas de coupe, pas de « qui reçoit », journées envoyées', () => {
    const d = withGame({ ...defaultDraft('private', NOW), format: 'cup' }, 'ludo');
    expect(d.format).toBe('championship');
    expect(d.boardRules).toEqual({ policy: 'imposed', allowed: ['ludo_classique'], defaultBoard: 'ludo_classique' });
    expect(policiesOf('ludo')).not.toContain('home');
    expect(draftRequest(d)).toMatchObject({ rounds: 6 });
  });

  it('planches : imposée = une seule, sinon au moins une, dans l’ordre du jeu', () => {
    let d = withPolicy(defaultDraft('private', NOW, 'ludo'), 'rotation');
    d = toggleBoard(d, 'ludo_six');
    d = toggleBoard(d, 'ludo_rapide');
    expect(d.boardRules.allowed).toEqual(['ludo_classique', 'ludo_rapide', 'ludo_six']);
    d = toggleBoard(toggleBoard(toggleBoard(d, 'ludo_classique'), 'ludo_rapide'), 'ludo_six');
    expect(d.boardRules.allowed).toEqual(['ludo_six']);
    expect(d.boardRules.defaultBoard).toBe('ludo_six');
    d = withPolicy(d, 'imposed');
    expect(toggleBoard(d, 'ludo_rapide').boardRules).toEqual({ policy: 'imposed', allowed: ['ludo_rapide'], defaultBoard: 'ludo_rapide' });
  });

  it('pas de planche amicale en ligue publique', () => {
    expect(boardChoices({ game: 'ludo', access: 'public' })).toEqual(['ludo_classique', 'ludo_rapide', 'ludo_six']);
    expect(boardChoices({ game: 'ludo', access: 'private' })).toContain('ludo_pachisi');
  });
});

describe('aperçus', () => {
  it('écran 31 : 16 places à 200 → caution 800, pot 4 000, champion 1 400, créateur 200', () => {
    expect(publicPreview(16, 200)).toEqual({ caution: 800, minPlayers: 8, pot: 4000, first: 1400, creator: 200 });
  });

  it('journées et matchs d’un championnat', () => {
    expect(championshipRounds(10, true)).toBe(18);
    expect(championshipRounds(14, false)).toBe(13);
    expect(championshipRounds(5, false)).toBe(5);
    expect(championshipMatches(14, false)).toBe(91);
  });

  it('formes de coupe possibles', () => {
    expect(cupShapes(8)).toEqual([
      { groups: 1, qualifiersPerGroup: 2 },
      { groups: 2, qualifiersPerGroup: 1 },
      { groups: 2, qualifiersPerGroup: 2 },
      { groups: 4, qualifiersPerGroup: 1 },
      { groups: 4, qualifiersPerGroup: 2 },
    ]);
    expect(cupShapes(3)).toEqual([{ groups: 1, qualifiersPerGroup: 2 }]);
  });

  it('pas des réglages', () => {
    expect(clampStep(17, 4, 64, 2)).toBe(18);
    expect(clampStep(2, 4, 64, 2)).toBe(4);
    expect(clampStep(1200, 50, 1000, 50)).toBe(1000);
  });
});

describe('lecture', () => {
  it('codes de ligue', () => {
    expect(leagueCodeFrom('k7l-iga')).toBe(null);
    expect(leagueCodeFrom('K7P-MGA')).toBe('K7PMGA');
    expect(leagueCodeFrom('kwatt://ligue/K7PMGA')).toBe('K7PMGA');
    expect(leagueCodeFrom('K7P')).toBe(null);
  });

  it('durées', () => {
    expect(hoursMinutes(9 * 3_600_000 + 12 * 60_000 + 5_000)).toEqual({ hours: 9, minutes: 12 });
    expect(daysHours(3 * 86_400_000 + 4 * 3_600_000)).toEqual({ days: 3, hours: 4 });
    expect(hoursMinutes(-5)).toEqual({ hours: 0, minutes: 0 });
  });

  it('jours et étapes de coupe', () => {
    expect(addDays('2026-11-28', 3)).toBe('2026-12-01');
    expect(endOfKwattDay('2026-11-07')).toBe('2026-11-07T22:59:00.000Z');
    expect([1, 2, 4, 8].map(knockoutStageKey)).toEqual(['final', 'semi', 'quarter', 'round']);
  });
});

describe('ligues par équipes', () => {
  const now = Date.UTC(2026, 10, 1, 8);

  it('passer en équipes : 3 aux Dames, 2 au Ludo, championnat, planche imposée ou par journée, pas de table de 6', () => {
    const dames = withTeams(defaultDraft('private', now), true);
    expect(dames).toMatchObject({ teamSize: 3, format: 'championship', maxPlaces: 10, boardRules: { policy: 'imposed', allowed: ['dames10'] } });
    expect(policiesOf('dames', true)).toEqual(['imposed', 'rotation']);
    const ludo = withTeams({ ...withGame(defaultDraft('private', now), 'ludo'), maxPlaces: 30, boardRules: { policy: 'rotation', allowed: ['ludo_six', 'ludo_classique', 'ludo_rapide'], defaultBoard: 'ludo_six' } }, true);
    expect(ludo).toMatchObject({ teamSize: 2, maxPlaces: 4, boardRules: { policy: 'rotation', allowed: ['ludo_classique', 'ludo_rapide'], defaultBoard: 'ludo_classique' } });
    expect(boardChoices({ game: 'ludo', access: 'private', teamSize: 2 })).not.toContain('ludo_six');
    expect(withGame(dames, 'ludo').teamSize).toBe(2);
    expect(withTeams(dames, false).teamSize).toBeNull();
    expect(draftRequest({ ...dames, name: ' Coupe ', teamName: ' Lions ' })).toMatchObject({ teamSize: 3, teamName: 'Lions' });
    expect('teamName' in draftRequest(defaultDraft('private', now))).toBe(false);
  });

  it('ordre du capitaine : échange de planches, couleurs alternées, ordre déposé repris', () => {
    expect(swapBoards(['a', 'b', 'c'], 0, 2)).toEqual(['c', 'b', 'a']);
    expect(swapBoards(['a', 'b', 'c'], 0, 5)).toEqual(['a', 'b', 'c']);
    expect([1, 2, 3].map((n) => boardColor('home', n))).toEqual(['white', 'black', 'white']);
    expect([1, 2, 3].map((n) => boardColor('away', n))).toEqual(['black', 'white', 'black']);
    const team = { id: 't1', players: ['a', 'b', 'c'].map((userId) => ({ userId, pseudo: userId, avatar: null })) };
    const match = { home: { id: 't0', name: 'X' }, away: { id: 't1', name: 'Y' }, lineups: { home: null, away: null } };
    expect(initialLineup(match, team)).toEqual(['a', 'b', 'c']);
    expect(initialLineup({ ...match, lineups: { home: null, away: ['c', 'a', 'b'] } }, team)).toEqual(['c', 'a', 'b']);
  });
});
