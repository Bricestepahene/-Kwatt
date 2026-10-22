/**
 * Profil unique (écran 09) : en-tête (apparence, pseudo, quartier), cauris, cartes,
 * médailles, et par jeu (Dames, Ludo, Raisonnement) : échelon, niveau, progression, force,
 * victoires / nuls / défaites et derniers matchs, lus dans player_ratings, games et
 * game_players. Le même écran sert au profil public d'un autre joueur (lecture seule).
 */
import { RATED_VARIANTS, START_RATING, levelProgress, standingFor } from '@kwatt/domain';
import {
  CARD_COLLECTION_SIZE,
  GAME_FAMILIES,
  type FamilyProfile,
  type GameFamily,
  type Profile,
  type RecentGame,
  type VariantStanding,
} from '@kwatt/protocol';
import type { FastifyInstance } from 'fastify';
import type { Sql } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { ageBand } from '../auth/age.js';
import { balanceOf } from '../economy/ledger.js';
import { countOwned } from '../shop/catalog.js';
import { medalsOf, quarterOf } from './links.js';
import { lookFromRow, lookRow } from './look.js';
import { canViewProfile } from './visibility.js';

/** Variantes de chaque jeu ; la première sert de référence tant que rien n'est joué. */
export const FAMILY_VARIANTS: Readonly<Record<GameFamily, readonly string[]>> = {
  dames: ['dames10', 'dames8'],
  ludo: ['ludo_classique', 'ludo_rapide', 'ludo_six', 'ludo_parchis', 'ludo_pachisi'],
  raisonnement: [],
};

const RATED: ReadonlySet<string> = new Set(RATED_VARIANTS);

export function familyOf(variant: string): GameFamily | null {
  for (const family of GAME_FAMILIES) if (FAMILY_VARIANTS[family].includes(variant)) return family;
  return null;
}

export function variantStanding(variant: string, rating: number, gamesPlayed: number): VariantStanding {
  const s = standingFor(rating);
  return {
    variant,
    rating,
    level: s.level,
    rank: s.rank,
    gamesPlayed,
    progress: levelProgress(rating),
    nextLevel: s.nextLevel,
    pointsToNextLevel: Math.max(0, s.pointsToNextLevel),
  };
}

/**
 * Variante principale d'un jeu : la plus jouée (à égalité, la plus forte) ; sans partie
 * classée, la variante de référence à la force de départ.
 */
export function primaryStanding(family: GameFamily, rows: readonly VariantStanding[]): VariantStanding | null {
  const reference = FAMILY_VARIANTS[family][0];
  if (reference === undefined) return null;
  const sorted = [...rows].sort((a, b) => b.gamesPlayed - a.gamesPlayed || b.rating - a.rating);
  return sorted[0] ?? variantStanding(reference, START_RATING, 0);
}

/** Résultat vu par le joueur : victoire, nul ou défaite (un abandon compte comme une défaite). */
export function outcomeOf(result: string | null, place: number | null): 'win' | 'draw' | 'loss' {
  if (result === 'draw') return 'draw';
  if (result === 'win') return 'win';
  if (result === null && place === 1) return 'win';
  return 'loss';
}

interface RecentRow {
  game_id: string;
  variant: string;
  context: 'machine' | 'room' | 'league';
  ranked: boolean;
  stake_per_player: number;
  ended_at: Date | null;
  result: string | null;
  place: number | null;
  player_count: number;
  opponents: Array<{ userId: string | null; name: string; machine: boolean }>;
  cauris: number | null;
  rating_delta: number | null;
}

async function recentGames(db: Sql, userId: string, variants: readonly string[], limit = 3): Promise<RecentGame[]> {
  if (variants.length === 0) return [];
  const r = await db.query<RecentRow>(
    `SELECT g.id AS game_id, g.variant::text AS variant, g.context, g.ranked, g.stake_per_player, g.ended_at,
            gp.result, gp.place,
            (SELECT count(*)::int FROM game_players x WHERE x.game_id = g.id) AS player_count,
            (SELECT COALESCE(json_agg(json_build_object(
                       'userId', o.user_id, 'name', o.display_name, 'machine', o.user_id IS NULL) ORDER BY o.seat), '[]'::json)
               FROM game_players o WHERE o.game_id = g.id AND o.seat <> gp.seat) AS opponents,
            (SELECT sum(e.amount)::int FROM ledger_transactions t
               JOIN ledger_entries e ON e.tx_id = t.id
               JOIN wallets w ON w.id = e.wallet_id
              WHERE t.game_id = g.id AND w.user_id = gp.user_id) AS cauris,
            (SELECT (rh.after - rh.before)::int FROM rating_history rh
              WHERE rh.game_id = g.id AND rh.user_id = gp.user_id LIMIT 1) AS rating_delta
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id
      WHERE gp.user_id = $1 AND g.status = 'finished' AND g.variant::text = ANY($2::text[])
      ORDER BY g.ended_at DESC NULLS LAST, g.id DESC
      LIMIT $3`,
    [userId, variants, limit],
  );
  return r.rows.map((row) => ({
    gameId: row.game_id,
    variant: row.variant,
    context: row.context,
    result: outcomeOf(row.result, row.place),
    place: row.place,
    playerCount: row.player_count,
    opponents: row.opponents.map((o) => ({ userId: o.userId, name: o.name, machine: o.machine })),
    stake: row.stake_per_player,
    cauris: row.cauris === null || row.cauris === 0 ? null : row.cauris,
    ratingDelta: row.rating_delta,
    ranked: row.ranked,
    endedAt: row.ended_at?.toISOString() ?? null,
  }));
}

export async function familyProfiles(db: Sql, userId: string): Promise<{ families: FamilyProfile[]; gamesPlayed: number }> {
  const [ratings, records] = await Promise.all([
    db.query<{ variant: string; rating: number; games_played: number }>(
      'SELECT variant::text AS variant, rating, games_played FROM player_ratings WHERE user_id = $1',
      [userId],
    ),
    db.query<{ variant: string; result: string | null; place: number | null; n: number }>(
      `SELECT g.variant::text AS variant, gp.result, gp.place, count(*)::int AS n
         FROM game_players gp JOIN games g ON g.id = gp.game_id
        WHERE gp.user_id = $1 AND g.status = 'finished'
        GROUP BY g.variant, gp.result, gp.place`,
      [userId],
    ),
  ]);

  let gamesPlayed = 0;
  const families: FamilyProfile[] = [];
  for (const family of GAME_FAMILIES) {
    const variants = FAMILY_VARIANTS[family];
    const standings = ratings.rows
      .filter((row) => RATED.has(row.variant) && variants.includes(row.variant))
      .map((row) => variantStanding(row.variant, row.rating, row.games_played))
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed || b.rating - a.rating);
    const record = { wins: 0, draws: 0, losses: 0 };
    for (const row of records.rows) {
      if (!variants.includes(row.variant)) continue;
      const o = outcomeOf(row.result, row.place);
      if (o === 'win') record.wins += row.n;
      else if (o === 'draw') record.draws += row.n;
      else record.losses += row.n;
    }
    gamesPlayed += record.wins + record.draws + record.losses;
    families.push({
      family,
      standing: primaryStanding(family, standings),
      variants: standings,
      record,
      recent: await recentGames(db, userId, variants),
    });
  }
  return { families, gamesPlayed };
}

interface TargetRow {
  kind: 'guest' | 'member';
  birth_year: number | null;
  erased_at: Date | null;
  delete_requested_at: Date | null;
  pseudo: string | null;
  created_at: Date;
}

/** Profil vu par `viewerId` (lui-même ou un autre joueur). */
export async function loadProfile(app: FastifyInstance, viewerId: string, targetId: string): Promise<Profile> {
  const db = app.db;
  const self = viewerId === targetId;
  const r = await db.query<TargetRow>(
    `SELECT u.kind, u.birth_year, u.erased_at, u.delete_requested_at, p.pseudo::text AS pseudo, p.created_at
       FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [targetId],
  );
  const target = r.rows[0];
  if (!target || target.kind !== 'member' || target.pseudo === null || target.erased_at !== null || target.delete_requested_at !== null) {
    throw new AppError('profiles.not_found', 404);
  }
  if (!self) {
    const band = target.birth_year === null ? null : ageBand(target.birth_year, app.clock.now());
    const age = band === 'adult' ? 'adult' : 'teen';
    if (!(await canViewProfile(db, viewerId, targetId, age))) throw new AppError('profiles.not_found', 404);
  }

  const row = await lookRow(db, targetId);
  if (!row) throw new AppError('profiles.not_found', 404);
  const [quarter, medals, cards, cauris, stats] = await Promise.all([
    quarterOf(db, targetId),
    medalsOf(db, targetId),
    countOwned(db, targetId, 'card'),
    self ? balanceOf(db, targetId) : Promise.resolve(null),
    familyProfiles(db, targetId),
  ]);

  return {
    userId: targetId,
    pseudo: target.pseudo,
    self,
    look: lookFromRow(row, app.media, self),
    photoPending: self && row.avatar_mode === 'photo' && row.photo_status === 'pending' && row.photo_path !== null,
    quarter,
    cauris,
    gamesPlayed: stats.gamesPlayed,
    cards: { owned: cards, total: CARD_COLLECTION_SIZE },
    medals,
    games: stats.families,
    memberSince: target.created_at.toISOString(),
  };
}
