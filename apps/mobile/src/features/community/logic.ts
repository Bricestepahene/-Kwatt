/**
 * Logique pure de Communauté et progression (testée sans écran) : où mène une notification,
 * sa bande de tissu, le regroupement Aujourd'hui / Hier, l'activité d'un ami, les filtres de
 * cartes, la position dans les échelons, et l'aperçu du Raisonnement.
 */
import { RANKS, rankForRating, type RankId } from '@kwatt/domain';
import type { Card, CardType, Friend, Notification, RatingItem } from '@kwatt/protocol';
import { NOTIFICATION_KINDS } from '@kwatt/protocol';

/** Fuseau du kwatt : les jours se comptent à l'heure de Douala. */
export const KWATT_OFFSET_MS = 60 * 60_000;

export function kwattDay(at: number): number {
  return Math.floor((at + KWATT_OFFSET_MS) / 86_400_000);
}

/** Bande de tissu d'une notification : bois (Dames), kaba (Ludo), ndop (hub), gain (récompense). */
export type NotificationBand = 'obom' | 'kaba' | 'ndop' | 'gain';

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function isKnownKind(kind: string): boolean {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

export function notificationBand(n: Pick<Notification, 'kind' | 'params'>): NotificationBand {
  const p = n.params;
  const game = str(p.game) ?? (str(p.variant)?.startsWith('dames') ? 'dames' : str(p.variant) ? 'ludo' : null);
  if (n.kind.startsWith('quest.') || n.kind.startsWith('rewards.')) return 'gain';
  if (game === 'dames') return 'obom';
  if (game === 'ludo') return 'kaba';
  if (n.kind.startsWith('league.')) return 'obom';
  return 'ndop';
}

/** Écran ouvert par une notification (null : rien à ouvrir). */
export function notificationHref(n: Pick<Notification, 'kind' | 'params'>): string | null {
  const p = n.params;
  const league = str(p.leagueId) ?? str(p.code);
  switch (n.kind) {
    case 'invites.room':
      return str(p.code) ? `/salon/${str(p.code)}` : null;
    case 'invites.challenge':
    case 'invites.challenge_countered':
    case 'invites.challenge_accepted':
    case 'invites.challenge_declined':
      return str(p.challengeId) ? `/defi/${str(p.challengeId)}` : null;
    case 'invites.friend_request':
      return '/amis?onglet=demandes';
    case 'friends.accepted':
      return '/amis';
    case 'league.match_tomorrow':
    case 'league.match_soon':
    case 'league.match_ready':
    case 'league.time_proposed':
    case 'league.time_agreed':
    case 'league.board_chosen':
    case 'league.forfeit':
      return league && str(p.matchId) ? `/ligue/${league}/match/${str(p.matchId)}` : league ? `/ligue/${league}` : null;
    case 'league.player_excluded':
      return league && str(p.excluded) ? `/ligue/${league}/exclusion?joueur=${str(p.excluded)}` : null;
    case 'league.excluded':
      return league ? `/ligue/${league}/exclusion` : null;
    case 'quest.completed':
    case 'quest.completed_card':
    case 'rewards.streak':
      return '/recompenses';
    case 'rewards.card':
      return '/cartes';
    case 'quarters.champion':
      return '/quartiers';
    case 'profile.photo_approved':
    case 'profile.photo_rejected':
      return '/avatar';
    default:
      return n.kind.startsWith('league.') && league ? `/ligue/${league}` : null;
  }
}

/** Libellé du bouton d'une notification (« Comprendre », « Voir »…), ou null. */
export function notificationAction(kind: string): 'understand' | 'see' | 'claim' | null {
  if (kind === 'league.player_excluded' || kind === 'league.excluded') return 'understand';
  if (kind === 'quest.completed' || kind === 'quest.completed_card' || kind === 'rewards.streak') return 'claim';
  if (kind === 'invites.room' || kind.startsWith('invites.challenge') || kind === 'invites.friend_request') return 'see';
  return null;
}

export interface NotificationGroups<T> {
  today: T[];
  yesterday: T[];
  earlier: T[];
}

/** Aujourd'hui, Hier, Plus tôt (jours du kwatt). */
export function groupByDay<T extends { createdAt: string }>(items: readonly T[], now: number): NotificationGroups<T> {
  const today = kwattDay(now);
  const out: NotificationGroups<T> = { today: [], yesterday: [], earlier: [] };
  for (const n of items) {
    const d = kwattDay(Date.parse(n.createdAt));
    (d >= today ? out.today : d === today - 1 ? out.yesterday : out.earlier).push(n);
  }
  return out;
}

// --- Amis ----------------------------------------------------------------------------

export type FriendStatus =
  | { kind: 'playing'; family: 'dames' | 'ludo' | null; move: number; watchable: boolean; gameId: string | null }
  | { kind: 'watching'; gameId: string | null }
  | { kind: 'available' }
  | { kind: 'offline'; lastSeenAt: number | null };

export function friendStatus(f: Friend): FriendStatus {
  if (!f.online) return { kind: 'offline', lastSeenAt: f.lastSeenAt ? Date.parse(f.lastSeenAt) : null };
  const a = f.activity;
  if (a?.kind === 'playing') {
    const progress = a.progress ?? 0;
    // Dames : demi-coups joués → numéro du coup ; Ludo : tour en cours.
    const move = a.family === 'dames' ? Math.floor(progress / 2) + 1 : Math.max(1, progress);
    return { kind: 'playing', family: a.family ?? null, move, watchable: a.watchable ?? false, gameId: a.gameId ?? null };
  }
  if (a?.kind === 'watching') return { kind: 'watching', gameId: a.gameId ?? null };
  return { kind: 'available' };
}

/** « vu il y a 3 h », « vu hier », « vu le 12 nov. » : la clé et sa valeur. */
export function lastSeen(at: number | null, now: number): { key: 'never' | 'minutes' | 'hours' | 'yesterday' | 'days' | 'date'; count: number } {
  if (at === null) return { key: 'never', count: 0 };
  const ms = Math.max(0, now - at);
  if (ms < 3_600_000) return { key: 'minutes', count: Math.max(1, Math.floor(ms / 60_000)) };
  const days = kwattDay(now) - kwattDay(at);
  if (days <= 0) return { key: 'hours', count: Math.floor(ms / 3_600_000) };
  if (days === 1) return { key: 'yesterday', count: 1 };
  if (days < 7) return { key: 'days', count: days };
  return { key: 'date', count: days };
}

/** Lien d'invitation par code d'ami. */
export function friendLink(code: string): string {
  return `kwatt://ami/${code}`;
}

// --- Cartes --------------------------------------------------------------------------

/** Filtres de la planche Cartes ; les dés sont rangés avec les plateaux. */
export type CardFilter = 'all' | 'table' | 'plateau' | 'pions' | 'pouvoir';
export const CARD_FILTERS: readonly CardFilter[] = ['all', 'table', 'plateau', 'pions', 'pouvoir'];

export function filterCards(cards: readonly Card[], filter: CardFilter): Card[] {
  if (filter === 'all') return [...cards];
  return cards.filter((c) => (c.type as CardType) === filter);
}

/** Possédées d'abord (ordre du catalogue), puis les verrouillées. */
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => Number(b.owned) - Number(a.owned));
}

/** Ce que dit une carte verrouillée : comment l'obtenir (clé + paramètres). */
export function unlockHint(c: Card): { key: string; params: Record<string, string | number> } {
  switch (c.how) {
    case 'rank':
      return { key: 'cards.how.rank', params: { rank: c.rank ?? 'apprenti' } };
    case 'streak':
      return c.days ? { key: 'cards.how.streakDays', params: { days: c.days } } : { key: 'cards.how.streak', params: {} };
    case 'feat':
      return { key: `cards.feat.${c.feat ?? 'unknown'}`, params: {} };
    case 'trophy':
      return { key: `cards.trophy.${c.trophy ?? 'unknown'}`, params: {} };
    case 'quest':
      return { key: 'cards.how.quest', params: {} };
    default:
      return { key: 'cards.how.start', params: {} };
  }
}

/** Effet d'une carte possédée (clé + paramètres). */
export function cardEffect(c: Card): { key: string; params: Record<string, string | number> } {
  if (c.type === 'table' && c.limit) return { key: 'cards.effect.table', params: { limit: c.limit } };
  if (c.effect) return { key: `cards.effect.${c.effect}`, params: {} };
  if (c.slot) return { key: `cards.effect.slot_${c.slot}`, params: { fabric: c.fabric } };
  return { key: 'cards.effect.trophy', params: {} };
}

// --- Échelons ------------------------------------------------------------------------

/** Meilleure force d'une famille de jeux (variantes classées jouées), ou null. */
export function bestRating(items: readonly RatingItem[], family: 'dames' | 'ludo'): RatingItem | null {
  const mine = items.filter((r) => (family === 'dames' ? r.variant.startsWith('dames') : r.variant.startsWith('ludo')));
  return mine.reduce<RatingItem | null>((best, r) => (best === null || r.rating > best.rating ? r : best), null);
}

/** Position dans les six échelons : index de l'échelon courant (0 = Apprenti). */
export function rankIndex(rating: number | null): number {
  return rating === null ? 0 : rankForRating(rating).index;
}

export function rankLevels(id: RankId): { min: number; max: number | null } {
  const r = RANKS.find((x) => x.id === id)!;
  return { min: r.minLevel, max: r.maxLevel };
}

// --- Raisonnement --------------------------------------------------------------------

export interface ReasoningQuestion {
  id: string;
  /** Suite ou calcul affiché tel quel (chiffres et signes). */
  prompt: string;
  options: readonly string[];
  answer: string;
}

/** Aperçu de la planche (question 1) et quelques autres. */
export const REASONING_PREVIEW: readonly ReasoningQuestion[] = [
  { id: 'pronic', prompt: '2 · 6 · 12 · 20 · 30 · ?', options: ['36', '40', '42', '44'], answer: '42' },
  { id: 'double', prompt: '3 · 6 · 12 · 24 · ?', options: ['30', '36', '48', '50'], answer: '48' },
  { id: 'squares', prompt: '1 · 4 · 9 · 16 · ?', options: ['20', '24', '25', '32'], answer: '25' },
  { id: 'mental', prompt: '17 × 6 = ?', options: ['92', '102', '106', '112'], answer: '102' },
  { id: 'fibo', prompt: '1 · 1 · 2 · 3 · 5 · 8 · ?', options: ['11', '12', '13', '14'], answer: '13' },
];

/** Temps de l'aperçu (00:42 sur la planche). */
export const REASONING_SECONDS = 45;

export function formatSeconds(s: number): string {
  const v = Math.max(0, Math.floor(s));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
