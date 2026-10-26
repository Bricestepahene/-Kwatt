import type { Card, Friend, RatingItem } from '@kwatt/protocol';
import { NOTIFICATION_KINDS } from '@kwatt/protocol';
import { describe, expect, it } from 'vitest';
import fr from '../../i18n/locales/fr/community.json';
import {
  REASONING_PREVIEW,
  bestRating,
  cardEffect,
  filterCards,
  formatSeconds,
  friendStatus,
  groupByDay,
  kwattDay,
  lastSeen,
  notificationAction,
  notificationBand,
  notificationHref,
  rankIndex,
  sortCards,
  unlockHint,
} from './logic';

const H = 3_600_000;
// 26 octobre 2026, 10 h à Douala (9 h UTC).
const NOW = Date.UTC(2026, 9, 26, 9);

describe('notifications', () => {
  it('chaque sorte a un titre et un texte dans le catalogue', () => {
    const kinds = fr.notifications.kind as Record<string, Record<string, { title: string; body: string }>>;
    for (const kind of NOTIFICATION_KINDS) {
      const [group, name] = kind.split('.') as [string, string];
      expect(kinds[group]?.[name]?.title, kind).toBeTruthy();
    }
  });

  it('bande de tissu : bois pour les Dames, kaba pour le Ludo, vert pour un gain', () => {
    expect(notificationBand({ kind: 'invites.challenge', params: { game: 'dames' } })).toBe('obom');
    expect(notificationBand({ kind: 'invites.room', params: { variant: 'ludo_classique' } })).toBe('kaba');
    expect(notificationBand({ kind: 'quest.completed', params: {} })).toBe('gain');
    expect(notificationBand({ kind: 'league.match_soon', params: {} })).toBe('obom');
    expect(notificationBand({ kind: 'friends.accepted', params: {} })).toBe('ndop');
  });

  it('écran ouvert par une notification', () => {
    expect(notificationHref({ kind: 'invites.room', params: { code: 'ABC234' } })).toBe('/salon/ABC234');
    expect(notificationHref({ kind: 'invites.challenge', params: { challengeId: 'c1' } })).toBe('/defi/c1');
    expect(notificationHref({ kind: 'invites.friend_request', params: {} })).toBe('/amis?onglet=demandes');
    expect(notificationHref({ kind: 'league.match_soon', params: { leagueId: 'L', matchId: 'M' } })).toBe('/ligue/L/match/M');
    expect(notificationHref({ kind: 'league.player_excluded', params: { leagueId: 'L', excluded: 'U' } })).toBe('/ligue/L/exclusion?joueur=U');
    expect(notificationHref({ kind: 'league.finished', params: { leagueId: 'L' } })).toBe('/ligue/L');
    expect(notificationHref({ kind: 'rewards.card', params: { code: 'x' } })).toBe('/cartes');
    expect(notificationHref({ kind: 'account.warning', params: {} })).toBeNull();
  });

  it('bouton : Comprendre pour une exclusion, Récupérer pour une quête', () => {
    expect(notificationAction('league.player_excluded')).toBe('understand');
    expect(notificationAction('quest.completed')).toBe('claim');
    expect(notificationAction('invites.challenge')).toBe('see');
    expect(notificationAction('league.finished')).toBeNull();
  });

  it("Aujourd'hui, Hier, Plus tôt à l'heure de Douala", () => {
    const at = (ms: number) => ({ createdAt: new Date(ms).toISOString() });
    // 23 h 30 UTC la veille = 0 h 30 à Douala : aujourd'hui.
    const lateUtc = Date.UTC(2026, 9, 25, 23, 30);
    const g = groupByDay([at(NOW - H), at(lateUtc), at(NOW - 26 * H), at(NOW - 72 * H)], NOW);
    expect(g.today).toHaveLength(2);
    expect(g.yesterday).toHaveLength(1);
    expect(g.earlier).toHaveLength(1);
    expect(kwattDay(lateUtc)).toBe(kwattDay(NOW));
  });
});

describe('amis', () => {
  const base: Friend = { userId: '00000000-0000-4000-8000-000000000001', pseudo: 'Mireille', avatar: null, online: true, lastSeenAt: null };

  it('en partie : coup en cours (Dames : demi-coups), regardable', () => {
    expect(friendStatus({ ...base, activity: { kind: 'playing', family: 'dames', progress: 27, watchable: true, gameId: 'g' } })).toEqual({
      kind: 'playing',
      family: 'dames',
      move: 14,
      watchable: true,
      gameId: 'g',
    });
    expect(friendStatus({ ...base, activity: { kind: 'playing', family: 'ludo', progress: 14 } })).toMatchObject({ move: 14, watchable: false });
    expect(friendStatus(base)).toEqual({ kind: 'available' });
    expect(friendStatus({ ...base, online: false, lastSeenAt: new Date(NOW).toISOString() })).toEqual({ kind: 'offline', lastSeenAt: NOW });
  });

  it('« vu il y a » : minutes, heures, hier, jours', () => {
    expect(lastSeen(null, NOW)).toEqual({ key: 'never', count: 0 });
    expect(lastSeen(NOW - 5 * 60_000, NOW)).toEqual({ key: 'minutes', count: 5 });
    expect(lastSeen(NOW - 3 * H, NOW)).toEqual({ key: 'hours', count: 3 });
    expect(lastSeen(NOW - 20 * H, NOW)).toEqual({ key: 'yesterday', count: 1 });
    expect(lastSeen(NOW - 4 * 24 * H, NOW)).toEqual({ key: 'days', count: 4 });
  });
});

describe('cartes', () => {
  const card = (over: Partial<Card>): Card => ({
    code: 'c',
    rarity: 'commune',
    type: 'table',
    slot: null,
    game: 'both',
    fabric: 'ndop',
    how: 'start',
    rank: null,
    feat: null,
    trophy: null,
    days: null,
    effect: null,
    limit: null,
    edition: null,
    owned: false,
    serial: null,
    equipped: false,
    acquiredAt: null,
    ...over,
  });

  it('filtre par type, possédées en premier', () => {
    const list = [card({ code: 'a', type: 'pions' }), card({ code: 'b', type: 'table', owned: true }), card({ code: 'c', type: 'pions', owned: true })];
    expect(filterCards(list, 'pions').map((c) => c.code)).toEqual(['a', 'c']);
    expect(sortCards(list).map((c) => c.code)).toEqual(['b', 'c', 'a']);
  });

  it('comment obtenir une carte verrouillée, et son effet', () => {
    expect(unlockHint(card({ how: 'rank', rank: 'notable' }))).toEqual({ key: 'cards.how.rank', params: { rank: 'notable' } });
    expect(unlockHint(card({ how: 'streak', days: 30 }))).toEqual({ key: 'cards.how.streakDays', params: { days: 30 } });
    expect(unlockHint(card({ how: 'feat', feat: 'rafle_4' })).key).toBe('cards.feat.rafle_4');
    expect(cardEffect(card({ type: 'table', limit: 500 }))).toEqual({ key: 'cards.effect.table', params: { limit: 500 } });
    expect(cardEffect(card({ type: 'plateau', slot: 'board', fabric: 'kaba' }))).toEqual({ key: 'cards.effect.slot_board', params: { fabric: 'kaba' } });
  });
});

describe('échelons et raisonnement', () => {
  const r = (variant: string, rating: number) => ({ variant, rating }) as RatingItem;

  it('meilleure force par jeu', () => {
    const items = [r('dames_10x10', 900), r('dames_8x8', 1100), r('ludo_classique', 700)];
    expect(bestRating(items, 'dames')?.rating).toBe(1100);
    expect(bestRating(items, 'ludo')?.rating).toBe(700);
    expect(bestRating([], 'ludo')).toBeNull();
    expect(rankIndex(null)).toBe(0);
  });

  it("l'aperçu a toujours la bonne réponse parmi les choix, chrono en mm:ss", () => {
    for (const q of REASONING_PREVIEW) expect(q.options).toContain(q.answer);
    expect(formatSeconds(42)).toBe('00:42');
    expect(formatSeconds(75)).toBe('01:15');
    expect(formatSeconds(-3)).toBe('00:00');
  });
});
