import type { FamilyProfile, RecentGame } from '@kwatt/protocol';
import { describe, expect, it } from 'vitest';
import { amountTone, groupByDay, journalDetail, journalKindKey, localDayKey } from './journal';
import { contextLine, isEmptyShowcase, opponentLine, pointsOf, resultBadge, resultTone } from './recent';

describe('journal des cauris', () => {
  it('traduit les motifs connus, « other » sinon', () => {
    expect(journalKindKey('purchase')).toBe('purchase');
    expect(journalKindKey('stake_payout')).toBe('stake_payout');
    expect(journalKindKey('motif_du_futur')).toBe('other');
  });

  it('tire le détail des méta : objet, adversaire, ligue, quête', () => {
    expect(journalDetail({ meta: { itemCode: 'preset_prince_wouri', itemKind: 'avatar_preset', serial: 313 } })).toEqual({
      kind: 'item',
      code: 'preset_prince_wouri',
      serial: 313,
    });
    expect(journalDetail({ meta: { opponent: { userId: null, pseudo: 'Mireille' } } })).toEqual({ kind: 'opponent', name: 'Mireille' });
    expect(journalDetail({ meta: { opponents: ['Armand', 'Odile'] } })).toEqual({ kind: 'opponents', names: ['Armand', 'Odile'] });
    expect(journalDetail({ meta: { leagueName: 'Coupe des Cousins' } })).toEqual({ kind: 'league', name: 'Coupe des Cousins' });
    expect(journalDetail({ meta: { quest: 'win_3_ludo' } })).toEqual({ kind: 'quest', code: 'win_3_ludo' });
    // Un champ mal formé est ignoré, sans casser l'écran.
    expect(journalDetail({ meta: { opponent: 'Mireille', reason: 'x' } })).toBeNull();
    expect(journalDetail({ meta: {} })).toBeNull();
  });

  it('range par jour : Aujourd\'hui, Hier, puis la date', () => {
    const now = new Date(2026, 9, 22, 15, 0);
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString();
    const days = groupByDay(
      [{ createdAt: at(22, 14) }, { createdAt: at(22, 9) }, { createdAt: at(21, 20) }, { createdAt: at(12, 8) }, { createdAt: at(12, 7) }],
      now,
    );
    expect(days.map((d) => [d.label, d.dayKey, d.items.length])).toEqual([
      ['today', '2026-10-22', 2],
      ['yesterday', '2026-10-21', 1],
      ['date', '2026-10-12', 2],
    ]);
    expect(localDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect([amountTone(10), amountTone(-450)]).toEqual(['gain', 'alert']);
  });
});

function game(fields: Partial<RecentGame>): RecentGame {
  return {
    gameId: '00000000-0000-4000-8000-000000000001',
    variant: 'dames10',
    context: 'room',
    result: 'win',
    place: 1,
    playerCount: 2,
    opponents: [{ userId: '00000000-0000-4000-8000-000000000002', name: 'Mireille', machine: false }],
    stake: 0,
    cauris: null,
    ratingDelta: null,
    ranked: true,
    endedAt: null,
    ...fields,
  };
}

describe('derniers matchs (écran 09)', () => {
  it('Dames : « V · contre Mireille · Défi · mise 200 · +200 cauris »', () => {
    const g = game({ stake: 200, cauris: 200 });
    expect(resultBadge(g)).toEqual({ kind: 'result', result: 'win' });
    expect(resultTone(g)).toBe('gain');
    expect(opponentLine(g)).toEqual({ key: 'recent.vsPlayer', params: { name: 'Mireille' } });
    expect(contextLine(g, 'dames')).toEqual({ key: 'recent.ctxStake', params: { stake: 200 } });
    expect(pointsOf(g)).toEqual({ kind: 'cauris', value: 200 });
  });

  it('contre la machine : la force bouge, pas les cauris', () => {
    const g = game({ context: 'machine', opponents: [{ userId: null, name: 'machine', machine: true }], ratingDelta: 14 });
    expect(opponentLine(g)).toEqual({ key: 'recent.vsMachine' });
    expect(contextLine(g, 'dames')).toEqual({ key: 'recent.ctxMachine' });
    expect(pointsOf(g)).toEqual({ kind: 'rating', value: 14 });
    const loss = game({ result: 'loss', place: 2, ratingDelta: -12 });
    expect([resultTone(loss), pointsOf(loss)]).toEqual(['alert', { kind: 'rating', value: -12 }]);
  });

  it('Ludo : la place, le pot, et les autres joueurs', () => {
    const opponents = [
      { userId: null, name: 'machine', machine: true },
      { userId: '00000000-0000-4000-8000-000000000003', name: 'Armand', machine: false },
      { userId: '00000000-0000-4000-8000-000000000004', name: 'Odile', machine: false },
    ];
    const first = game({ variant: 'ludo_classique', playerCount: 4, place: 1, stake: 100, cauris: 300, opponents });
    expect(resultBadge(first)).toEqual({ kind: 'place', place: 1 });
    expect(opponentLine(first)).toEqual({ key: 'recent.vsPlayerOthers', params: { name: 'Armand', count: 2 } });
    expect(contextLine(first, 'ludo')).toEqual({ key: 'recent.ctxPot', params: { count: 4, pot: 400 } });
    expect(resultTone(game({ playerCount: 3, place: 3, result: 'loss' }))).toBe('alert');
    expect(resultTone(game({ playerCount: 3, place: 2, result: 'loss' }))).toBe('muted');
    expect(contextLine(game({ playerCount: 3 }), 'ludo')).toEqual({ key: 'recent.ctxPlayers', params: { count: 3 } });
  });

  it('un compte effacé devient « Joueur parti »', () => {
    expect(opponentLine(game({ opponents: [{ userId: null, name: '', machine: false }] }))).toEqual({ key: 'recent.vsFormer' });
  });

  it('vitrine vide tant qu\'aucune partie n\'est terminée', () => {
    const family: FamilyProfile = { family: 'dames', standing: null, variants: [], record: { wins: 0, draws: 0, losses: 0 }, recent: [] };
    expect(isEmptyShowcase(family)).toBe(true);
    expect(isEmptyShowcase({ ...family, record: { wins: 1, draws: 0, losses: 0 } })).toBe(false);
  });
});
