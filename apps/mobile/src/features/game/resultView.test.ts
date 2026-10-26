import type { GameSummary } from '@kwatt/protocol';
import { describe, expect, it } from 'vitest';
import type { LocalGame } from './historyStore';
import { fromLocalGame, fromSummary, longestCapture } from './resultView';

const local: LocalGame = {
  id: 'g1',
  family: 'dames',
  variant: 'dames10',
  context: 'machine',
  seats: [
    { seat: 0, userId: 'me', name: 'Brice' },
    { seat: 1, userId: null, name: 'Machine', machine: { difficulty: 'coriace' } },
  ],
  mySeats: [0],
  moves: ['32-28', '19-23', '28x19'],
  outcome: { places: { 0: 1, 1: 2 }, draw: false, reason: 'no_moves' },
  machine: { difficulty: 'coriace', mode: 'chosen', bet: 0, offline: true, pending: true },
  playedAt: '2026-10-22T10:00:00.000Z',
};

const summary = (over: Partial<GameSummary> = {}): GameSummary => ({
  id: 'g2',
  family: 'dames',
  variant: 'dames10',
  context: 'room',
  status: 'finished',
  seats: [
    { seat: 0, userId: 'me', pseudo: 'Brice' },
    { seat: 1, userId: 'mi', pseudo: 'Mireille' },
  ],
  moves: Array.from({ length: 92 }, () => '1-2'),
  outcome: { places: { '0': 1, '1': 2 }, draw: false, reason: 'no_moves' },
  stake: 200,
  pot: 400,
  ratingChanges: { me: { before: 1500, after: 1518, delta: 18, levelBefore: 17, levelAfter: 17 } },
  room: { code: 'M4TK9Q', format: 'simple' },
  startedAt: null,
  endedAt: null,
  ...over,
});

describe('fin de partie (écran 18)', () => {
  it('Ludo local : règles maison transmises, la sortie « x:0 » ne compte pas comme un tour', () => {
    const v = fromLocalGame({
      ...local,
      family: 'ludo',
      variant: 'ludo_classique',
      moves: ['6:0', '3:0', 'x:0'],
      house: { capture: 'home_bonus20' },
      outcome: { places: { 0: 2, 1: 1 }, draw: false, reason: 'resign' },
    });
    expect(v).toMatchObject({ verdict: 'loss', moveCount: 2, house: { capture: 'home_bonus20' } });
    expect(fromLocalGame(local).house).toBeNull();
  });

  it('partie locale contre la machine : victoire en attente du réseau', () => {
    const v = fromLocalGame(local);
    expect(v).toMatchObject({ verdict: 'win', myPlace: 1, moveCount: 2, pending: true, myCauris: null, next: { kind: 'machine' } });
    expect(v.opponent?.machine).toBe('coriace');
    const settled = fromLocalGame({ ...local, settlement: { net: 40, base: 40, participation: 0, betNet: 0, streakBonus: false, counted: true }, machine: { ...local.machine!, pending: false } });
    expect(settled).toMatchObject({ pending: false, myCauris: 40 });
  });

  it('défi avec mise : +200 / −200, force, revanche même mise', () => {
    const v = fromSummary(summary(), 'me');
    expect(v).toMatchObject({ verdict: 'win', myCauris: 200, opponentCauris: -200, moveCount: 46 });
    expect(v.rating?.delta).toBe(18);
    expect(v.next).toMatchObject({ kind: 'rematch', stake: 200, code: 'M4TK9Q' });
    expect(fromSummary(summary(), 'mi').verdict).toBe('loss');
  });

  it('nulle : chacun récupère sa mise', () => {
    const v = fromSummary(summary({ outcome: { places: { '0': 1, '1': 1 }, draw: true, reason: 'quiet_kings' } }), 'me');
    expect(v).toMatchObject({ verdict: 'draw', myCauris: 0, opponentCauris: 0, reason: 'quiet_kings' });
  });

  it('salon roi de la table et aller-retour', () => {
    const king = fromSummary(summary({ room: { code: 'ABCDEF', format: 'roi', nextChallenger: { userId: 'j', pseudo: 'Junior' } } }), 'me');
    expect(king.next).toEqual({ kind: 'king', code: 'ABCDEF', stays: true, next: { userId: 'j', pseudo: 'Junior' } });
    const leg = fromSummary(summary({ room: { code: 'ABCDEF', format: 'aller_retour', leg: 1 } }), 'mi');
    expect(leg.next).toMatchObject({ kind: 'return_leg', code: 'ABCDEF' });
  });

  it('Ludo : places du 1er au dernier, même table', () => {
    const v = fromSummary(
      summary({
        family: 'ludo',
        variant: 'ludo_classique',
        stake: 0,
        pot: 0,
        seats: [
          { seat: 0, userId: 'a', pseudo: 'A' },
          { seat: 1, userId: 'me', pseudo: 'Brice' },
          { seat: 2, userId: 'c', pseudo: 'C' },
        ],
        outcome: { places: { '0': 3, '1': 2, '2': 1 }, draw: false, reason: 'all_home' },
      }),
      'me',
    );
    expect(v).toMatchObject({ verdict: 'loss', myPlace: 2, playerCount: 3, next: { kind: 'same_table', code: 'M4TK9Q' } });
    expect(v.players.map((p) => p.name)).toEqual(['C', 'Brice', 'A']);
  });

  it('plus grande rafle d’un camp', () => {
    expect(longestCapture(['32-28', '19-23', '28x19x10x1', '1-2'], 'even')).toBe(3);
    expect(longestCapture(['32-28', '19-23', '28x19x10x1'], 'odd')).toBe(0);
  });
});
