/**
 * Force par variante classée (contrat C1, SPEC §7) : `recordRatedResult` met à jour
 * `player_ratings` (créée à 900 au premier passage) et `rating_history`, avec les calculs
 * purs de @kwatt/domain (`rateDuel`, `rateMultiplayer`, `levelFromRating`, `rankForRating`).
 *
 * - Une machine n'a pas de ligne : sa force sert seulement d'adversaire.
 * - Idempotent par (partie, joueur) : un second appel rend les variations déjà écrites,
 *   sans rien recompter.
 * - Places : 1 = gagnant ; nulle = mêmes places.
 */
import {
  START_RATING,
  isRatedVariant,
  levelFromRating,
  pointsToNextLevel,
  rankForRating,
  rateDuel,
  rateMultiplayer,
  type DuelScore,
  type RatedVariant,
} from '@kwatt/domain';
import type { RatingItem } from '@kwatt/protocol';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';

export interface RatedParticipant {
  /** null : la machine. */
  userId: string | null;
  /** Force de la machine (obligatoire pour une machine). */
  machineRating?: number;
  /** Place à l'arrivée (1 = gagnant ; nulle = mêmes places). */
  place: number;
}

export interface RatedResultInput {
  gameId: string;
  variant: RatedVariant;
  participants: RatedParticipant[];
  /** Contexte (statistiques de calibrage) ; facultatif. */
  context?: 'machine' | 'room' | 'league';
}

export interface RatingDelta {
  before: number;
  after: number;
  delta: number;
  levelBefore: number;
  levelAfter: number;
}

/** Un participant humain gagne, perd ou fait nulle selon les places de tous. */
function resultOf(place: number, places: number[]): 'win' | 'draw' | 'loss' {
  const best = Math.min(...places);
  if (places.every((p) => p === place)) return 'draw';
  return place === best ? 'win' : 'loss';
}

function deltaOf(before: number, after: number): RatingDelta {
  return { before, after, delta: after - before, levelBefore: levelFromRating(before), levelAfter: levelFromRating(after) };
}

/** Une machine a un nombre de parties « établi » : son K n'importe pas, elle ne bouge pas. */
const MACHINE_GAMES = 1_000;

export async function recordRatedResult(db: Pool | Transaction, input: RatedResultInput): Promise<Record<string, RatingDelta>> {
  if (!isRatedVariant(input.variant)) throw new Error(`Variante non classée : ${input.variant}`);
  if (input.participants.length < 2) throw new Error('Il faut au moins deux participants');
  const humans = input.participants.filter((p): p is RatedParticipant & { userId: string } => p.userId !== null);
  if (new Set(humans.map((h) => h.userId)).size !== humans.length) throw new Error('Joueur en double');
  for (const p of input.participants) {
    if (p.userId === null && !Number.isFinite(p.machineRating)) throw new Error('Force de la machine manquante');
  }

  return transaction(db, async (tx) => {
    // Verrou des lignes de force, dans l'ordre des identifiants (pas d'interblocage).
    const ids = [...humans.map((h) => h.userId)].sort();
    for (const id of ids) {
      await tx.query(
        `INSERT INTO player_ratings (user_id, variant, rating, level, echelon)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, variant) DO NOTHING`,
        [id, input.variant, START_RATING, levelFromRating(START_RATING), rankForRating(START_RATING).id],
      );
    }
    const rows = await tx.query<{ user_id: string; rating: number; games_played: number }>(
      `SELECT user_id, rating, games_played FROM player_ratings
        WHERE variant = $1 AND user_id = ANY($2::uuid[]) ORDER BY user_id FOR UPDATE`,
      [input.variant, ids],
    );
    const current = new Map(rows.rows.map((r) => [r.user_id, r]));

    // Déjà compté pour ce joueur : on rend ce qui est écrit.
    const done = await tx.query<{ user_id: string; before: number; after: number }>(
      `SELECT user_id, before, after FROM rating_history WHERE variant = $1 AND game_id = $2 AND user_id = ANY($3::uuid[])`,
      [input.variant, input.gameId, ids],
    );
    const result: Record<string, RatingDelta> = {};
    for (const r of done.rows) result[r.user_id] = deltaOf(r.before, r.after);

    const players = input.participants.map((p) => {
      if (p.userId === null) return { rating: Math.round(p.machineRating!), gamesPlayed: MACHINE_GAMES, place: p.place };
      const row = current.get(p.userId);
      return { rating: row?.rating ?? START_RATING, gamesPlayed: row?.games_played ?? 0, place: p.place };
    });
    let changes: { before: number; after: number; delta: number }[];
    if (players.length === 2) {
      const [a, b] = players as [(typeof players)[0], (typeof players)[0]];
      const scoreA: DuelScore = a.place < b.place ? 1 : a.place === b.place ? 0.5 : 0;
      const duel = rateDuel(a, b, scoreA);
      changes = [duel.a, duel.b];
    } else {
      changes = rateMultiplayer(players);
    }
    const places = input.participants.map((p) => p.place);

    for (const [i, p] of input.participants.entries()) {
      if (p.userId === null || result[p.userId]) continue;
      const change = changes[i]!;
      const outcome = resultOf(p.place, places);
      // Adversaire : la moyenne des autres (statistiques de calibrage).
      const others = players.filter((_, j) => j !== i);
      const opponentRating = Math.round(others.reduce((s, o) => s + o.rating, 0) / others.length);
      await tx.query(
        `UPDATE player_ratings
            SET rating = $3, games_played = games_played + 1, level = $4, echelon = $5,
                wins = wins + $6, draws = draws + $7, losses = losses + $8, updated_at = now()
          WHERE user_id = $1 AND variant = $2`,
        [
          p.userId,
          input.variant,
          change.after,
          Math.min(32_767, levelFromRating(change.after)),
          rankForRating(change.after).id,
          outcome === 'win' ? 1 : 0,
          outcome === 'draw' ? 1 : 0,
          outcome === 'loss' ? 1 : 0,
        ],
      );
      await tx.query(
        `INSERT INTO rating_history (user_id, variant, game_id, before, after, opponent_rating, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.userId, input.variant, input.gameId, change.before, change.after, opponentRating, input.context ?? null],
      );
      result[p.userId] = deltaOf(change.before, change.after);
    }
    return result;
  });
}

/** Force actuelle d'un joueur dans une variante (900 s'il n'a jamais joué). */
export async function ratingOf(db: Sql, userId: string, variant: RatedVariant): Promise<{ rating: number; gamesPlayed: number }> {
  const r = await db.query<{ rating: number; games_played: number }>(
    'SELECT rating, games_played FROM player_ratings WHERE user_id = $1 AND variant = $2',
    [userId, variant],
  );
  const row = r.rows[0];
  return row ? { rating: row.rating, gamesPlayed: row.games_played } : { rating: START_RATING, gamesPlayed: 0 };
}

/** GET /v1/ratings/me : variantes classées déjà jouées. */
export async function myRatings(db: Sql, userId: string): Promise<RatingItem[]> {
  const r = await db.query<{ variant: string; rating: number; games_played: number; wins: number; draws: number; losses: number }>(
    `SELECT variant::text AS variant, rating, games_played, wins, draws, losses
       FROM player_ratings WHERE user_id = $1 ORDER BY games_played DESC, variant`,
    [userId],
  );
  return r.rows
    .filter((row): row is typeof row & { variant: RatedVariant } => isRatedVariant(row.variant))
    .map((row) => ({
      variant: row.variant,
      rating: row.rating,
      level: levelFromRating(row.rating),
      rank: rankForRating(row.rating).id,
      gamesPlayed: row.games_played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      pointsToNextLevel: pointsToNextLevel(row.rating).points,
    }));
}
