/**
 * Guerre des quartiers (écran 36, D-11). Points à chaque partie classée gagnée entre joueurs
 * (@kwatt/domain quarterPoints / quarterPointsMulti), classements par quartier, ville et pays
 * pour la saison (mois civil, heure du Cameroun), tendance depuis ce matin, et clôture de
 * saison : le quartier champion gagne un cadre de profil (et sa carte) pour tous ses joueurs.
 */
import {
  dayKey,
  quarterPoints,
  quarterPointsMulti,
  rankQuarters,
  seasonChampion,
  seasonDaysLeft,
  seasonKey,
  seasonNumber,
} from '@kwatt/domain';
import type { QuarterScope, QuarterStanding, QuarterStandings } from '@kwatt/protocol';
import { transaction, type Pool, type Sql } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import type { Logger } from '../../lib/logger.js';
import type { GameFinishedEvent } from '../games/service.js';
import type { NotificationService } from '../notifications/service.js';
import { grantItem } from '../shop/catalog.js';

export const CHAMPION_FRAME = 'frame_quartier_champion';
export const CHAMPION_CARD = 'card_trophee_quartier';

export interface QuartersDeps {
  db: Pool;
  clock: Clock;
  log: Logger;
  notifications: NotificationService;
}

interface PlayerInfo {
  userId: string;
  quarter: string | null;
  rating: number;
}

interface ScoreRow {
  key: string;
  name: string | null;
  city: string | null;
  city_en: string | null;
  country: string;
  points: number;
  players: number;
}

const DEFAULT_RATING = 900;

export class QuartersService {
  constructor(private readonly deps: QuartersDeps) {}

  /** Force avant la partie (historique), le quartier du moment. */
  private async players(gameId: string, variant: string, userIds: string[]): Promise<Map<string, PlayerInfo>> {
    const r = await this.deps.db.query<{ id: string; quarter: string | null; before: number | null; rating: number | null }>(
      `SELECT u.id, p.quarter,
              (SELECT h.before FROM rating_history h WHERE h.user_id = u.id AND h.game_id = $1) AS before,
              (SELECT pr.rating FROM player_ratings pr WHERE pr.user_id = u.id AND pr.variant::text = $2) AS rating
         FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE u.id = ANY($3::uuid[])`,
      [gameId, variant, userIds],
    );
    return new Map(r.rows.map((x) => [x.id, { userId: x.id, quarter: x.quarter, rating: x.before ?? x.rating ?? DEFAULT_RATING }]));
  }

  /** Fin de partie : points au quartier du gagnant (partie classée entre joueurs). */
  async onGameFinished(event: GameFinishedEvent): Promise<void> {
    if (!event.ranked || event.context === 'machine' || event.outcome.draw) return;
    const humans = event.seats.filter((s): s is typeof s & { userId: string } => s.userId !== null);
    if (humans.length < 2) return;
    const place = (seat: number) => event.outcome.places[String(seat)] ?? 99;
    const winners = humans.filter((s) => place(s.seat) === 1);
    if (winners.length !== 1) return;
    const winner = winners[0]!;
    const info = await this.players(event.gameId, event.variant, humans.map((s) => s.userId));
    const w = info.get(winner.userId);
    if (!w?.quarter) return;
    const beaten = humans.filter((s) => s.userId !== winner.userId).map((s) => info.get(s.userId)).filter((x): x is PlayerInfo => !!x);
    if (beaten.length === 0) return;
    const points =
      beaten.length === 1
        ? quarterPoints({ ranked: true, winnerRating: w.rating, loserRating: beaten[0]!.rating, winnerQuarter: w.quarter, loserQuarter: beaten[0]!.quarter })
        : quarterPointsMulti({ ranked: true, winnerRating: w.rating, winnerQuarter: w.quarter, beaten: beaten.map((b) => ({ rating: b.rating, quarter: b.quarter })) });
    if (points <= 0) return;
    const now = this.deps.clock.now();
    await this.deps.db.query(
      `INSERT INTO quarter_points (game_id, user_id, quarter_id, season, points, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [event.gameId, winner.userId, w.quarter, seasonKey(now.getTime()), points, now],
    );
  }

  /** Points et joueurs de la saison, par quartier, ville ou pays. */
  private async scores(db: Sql, season: string, scope: QuarterScope, filter: { country?: string; city?: string }): Promise<ScoreRow[]> {
    const keyExpr = scope === 'quarter' ? 'q.id' : scope === 'city' ? "q.country || ':' || q.city" : 'q.country';
    const nameExpr = scope === 'quarter' ? 'min(q.name)' : 'NULL::text';
    const cityExpr = scope === 'country' ? 'NULL::text' : 'min(q.city)';
    const cityEnExpr = scope === 'country' ? 'NULL::text' : 'min(q.city_en)';
    const r = await db.query<ScoreRow>(
      `SELECT ${keyExpr} AS key, ${nameExpr} AS name, ${cityExpr} AS city, ${cityEnExpr} AS city_en, min(q.country) AS country,
              COALESCE(sum(pts.points), 0)::int AS points, COALESCE(sum(pl.players), 0)::int AS players
         FROM quarters q
         LEFT JOIN (SELECT quarter_id, sum(points)::int AS points FROM quarter_points WHERE season = $1 GROUP BY quarter_id) pts ON pts.quarter_id = q.id
         LEFT JOIN (SELECT quarter, count(*)::int AS players FROM profiles WHERE quarter IS NOT NULL GROUP BY quarter) pl ON pl.quarter = q.id
        WHERE ($2::text IS NULL OR q.country = $2) AND ($3::text IS NULL OR q.city = $3)
        GROUP BY ${keyExpr}
       HAVING COALESCE(sum(pts.points), 0) > 0 OR COALESCE(sum(pl.players), 0) > 0`,
      [season, filter.country ?? null, filter.city ?? null],
    );
    return r.rows;
  }

  private async firstSeason(fallback: string): Promise<string> {
    const r = await this.deps.db.query<{ s: string | null }>('SELECT min(season) AS s FROM quarter_points');
    const first = r.rows[0]?.s ?? null;
    return first && first < fallback ? first : fallback;
  }

  async standings(userId: string, scope: QuarterScope): Promise<QuarterStandings> {
    const now = this.deps.clock.now().getTime();
    const season = seasonKey(now);
    const mineQ = await this.deps.db.query<{ id: string; country: string; city: string; city_en: string | null }>(
      'SELECT q.id, q.country, q.city, q.city_en FROM profiles p JOIN quarters q ON q.id = p.quarter WHERE p.user_id = $1',
      [userId],
    );
    const my = mineQ.rows[0] ?? null;
    const filter = scope === 'quarter' ? (my ? { country: my.country, city: my.city } : {}) : scope === 'city' ? (my ? { country: my.country } : { country: 'CM' }) : {};
    const rows = await this.scores(this.deps.db, season, scope, filter);
    const ranked = rankQuarters(rows.map((x) => ({ id: x.key, points: x.points, players: x.players })));
    const byKey = new Map(rows.map((x) => [x.key, x]));
    const snap = await this.deps.db.query<{ key: string; position: number }>('SELECT key, position FROM quarter_rank_snapshots WHERE day = $1 AND scope = $2', [
      dayKey(now),
      scope,
    ]);
    // La photo du matin couvre tout le classement : on la ramène au périmètre affiché.
    const before = new Map<string, number>();
    const inScope = snap.rows.filter((x) => byKey.has(x.key)).sort((a, b) => a.position - b.position);
    inScope.forEach((x, i) => before.set(x.key, i + 1));
    const view = (e: { id: string; points: number; players: number; position: number }): QuarterStanding => {
      const row = byKey.get(e.id)!;
      const was = before.get(e.id);
      return {
        key: e.id,
        name: row.name,
        city: row.city,
        cityEn: row.city_en,
        country: row.country,
        players: e.players,
        points: e.points,
        position: e.position,
        trend: was === undefined ? null : was - e.position,
      };
    };
    const myKey = !my ? null : scope === 'quarter' ? my.id : scope === 'city' ? `${my.country}:${my.city}` : my.country;
    const mineEntry = myKey ? ranked.find((e) => e.id === myKey) : undefined;
    const myPoints = await this.deps.db.query<{ n: number }>('SELECT COALESCE(sum(points), 0)::int AS n FROM quarter_points WHERE user_id = $1 AND season = $2', [
      userId,
      season,
    ]);
    const last = await this.deps.db.query<{ id: string; name: string | null; city: string }>(
      `SELECT q.id, q.name, q.city FROM quarter_seasons s JOIN quarters q ON q.id = s.champion_id ORDER BY s.season DESC LIMIT 1`,
    );
    return {
      season,
      seasonNumber: seasonNumber(season, await this.firstSeason(season)),
      daysLeft: seasonDaysLeft(now),
      scope,
      area: scope === 'country' ? null : scope === 'quarter' && my ? { city: my.city, cityEn: my.city_en, country: my.country } : { city: null, cityEn: null, country: my?.country ?? 'CM' },
      items: ranked.slice(0, 30).map(view),
      mine: mineEntry ? view(mineEntry) : null,
      myPoints: myPoints.rows[0]?.n ?? 0,
      lastChampion: last.rows[0] ? { key: last.rows[0].id, name: last.rows[0].name, city: last.rows[0].city } : null,
    };
  }

  /** Photo du classement au début du jour (tendance). Idempotent. */
  async snapshot(): Promise<void> {
    const now = this.deps.clock.now().getTime();
    const day = dayKey(now);
    const done = await this.deps.db.query('SELECT 1 FROM quarter_rank_snapshots WHERE day = $1 LIMIT 1', [day]);
    if ((done.rowCount ?? 0) > 0) return;
    const season = seasonKey(now);
    await transaction(this.deps.db, async (tx) => {
      for (const scope of ['quarter', 'city', 'country'] as const) {
        const ranked = rankQuarters((await this.scores(tx, season, scope, {})).map((x) => ({ id: x.key, points: x.points, players: x.players })));
        for (const e of ranked) {
          await tx.query('INSERT INTO quarter_rank_snapshots (day, scope, key, position, points) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [
            day,
            scope,
            e.id,
            e.position,
            e.points,
          ]);
        }
      }
      // On ne garde que 40 jours de photos.
      await tx.query("DELETE FROM quarter_rank_snapshots WHERE day < to_char(($1::timestamptz - interval '40 days'), 'YYYY-MM-DD')", [new Date(now)]);
    });
  }

  /** Clôture des saisons passées : champion, cadre et carte pour tous ses joueurs. */
  async closeSeasons(): Promise<string[]> {
    const current = seasonKey(this.deps.clock.now().getTime());
    const open = await this.deps.db.query<{ season: string }>(
      `SELECT DISTINCT season FROM quarter_points p
        WHERE season < $1 AND NOT EXISTS (SELECT 1 FROM quarter_seasons s WHERE s.season = p.season) ORDER BY season`,
      [current],
    );
    const closed: string[] = [];
    for (const { season } of open.rows) {
      const rows = await this.scores(this.deps.db, season, 'quarter', {});
      const champion = seasonChampion(rows.map((x) => ({ id: x.key, points: x.points, players: x.players })));
      const inserted = await this.deps.db.query('INSERT INTO quarter_seasons (season, champion_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [season, champion]);
      if ((inserted.rowCount ?? 0) === 0) continue;
      closed.push(season);
      if (!champion) continue;
      const players = await this.deps.db.query<{ user_id: string }>(
        `SELECT p.user_id FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.quarter = $1 AND u.erased_at IS NULL`,
        [champion],
      );
      for (const { user_id } of players.rows) {
        try {
          await transaction(this.deps.db, async (tx) => {
            const frame = await grantItem(tx, user_id, CHAMPION_FRAME, 'reward');
            await grantItem(tx, user_id, CHAMPION_CARD, 'reward');
            if (frame.granted) await this.deps.notifications.notify(tx, user_id, 'quarters.champion', { quarterId: champion, season });
          });
        } catch (err) {
          this.deps.log.error({ err, userId: user_id, season }, 'récompense du quartier champion en échec');
        }
      }
    }
    return closed;
  }
}
