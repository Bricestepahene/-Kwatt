/**
 * Accueil du hub (écran 07) : notifications à traiter, salons ouverts, prochain match de
 * ligue, partie à reprendre, ligue publique du moment. Voir @kwatt/protocol (http/home.ts).
 */
import type { HomeView } from '@kwatt/protocol';
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/plugin.js';

const homeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/home', { preHandler: app.requireMember }, async (req): Promise<HomeView> => {
    const me = requireAuth(req).userId;
    const now = app.clock.now();
    const db = app.db;

    const unread = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [me]);
    const challenges = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM challenges WHERE status = 'pending' AND awaiting = $1 AND expires_at > $2",
      [me, now],
    );
    const rooms = await db.query<{ game: string; n: number }>(
      `SELECT CASE WHEN variant::text LIKE 'dames%' THEN 'dames' ELSE 'ludo' END AS game, count(*)::int AS n
         FROM rooms WHERE status = 'open' AND listed GROUP BY 1`,
    );

    // Parties en cours : à reprendre, et « c'est ton tour ».
    const mine = await db.query<{ id: string }>(
      `SELECT g.id FROM games g JOIN game_players p ON p.game_id = g.id
        WHERE p.user_id = $1 AND g.status = 'playing' AND p.out_at IS NULL ORDER BY g.started_at DESC LIMIT 10`,
      [me],
    );
    let myTurns = 0;
    let resume: HomeView['resume'] = null;
    for (const row of mine.rows) {
      const actor = await app.games.get(row.id);
      if (!actor || actor.status !== 'playing') continue;
      const turn = actor.rules.turnSeat();
      const myTurn = turn !== null && actor.seatsOf(me).includes(turn);
      if (myTurn) myTurns++;
      if (resume) continue;
      const cfg = actor.config;
      const others = cfg.seats.filter((s) => s.userId !== me).map((s) => s.name);
      let where: string | null = null;
      if (cfg.rules.room) where = (await db.query<{ name: string }>('SELECT name FROM rooms WHERE id = $1', [cfg.rules.room.roomId])).rows[0]?.name ?? null;
      if (cfg.rules.league) where = (await db.query<{ name: string }>('SELECT name FROM leagues WHERE id = $1', [cfg.rules.league.leagueId])).rows[0]?.name ?? null;
      resume = { gameId: cfg.id, family: cfg.family === 'dames' ? 'dames' : 'ludo', variant: cfg.variant, myTurn, where, opponents: others };
    }

    const next = await db.query<{
      league_id: string;
      name: string;
      game: 'dames' | 'ludo';
      id: string;
      stage: 'league' | 'group' | 'knockout' | 'decider';
      round: number;
      level: number | null;
      levels: number | null;
      match_at: Date;
      opponents: string[];
    }>(
      `SELECT m.league_id, l.name, l.game, m.id, m.stage, m.round, m.level,
              (SELECT max(k.level) FROM league_matches k WHERE k.league_id = m.league_id AND k.stage = 'knockout')::int AS levels,
              m.match_at,
              ARRAY(SELECT COALESCE(p.pseudo::text, '?') FROM unnest(m.players) AS x(id) LEFT JOIN profiles p ON p.user_id = x.id WHERE x.id <> $1) AS opponents
         FROM league_matches m JOIN leagues l ON l.id = m.league_id
        WHERE $1 = ANY(m.players) AND m.status IN ('scheduled', 'playing') AND l.status = 'running'
        ORDER BY m.match_at LIMIT 1`,
      [me],
    );
    const n = next.rows[0];

    const pub = await db.query<{ id: string; code: string; name: string; game: 'dames' | 'ludo'; players: number; max_places: number; entry: number; registration_closes_at: Date | null }>(
      `SELECT l.id, l.code, l.name, l.game, l.max_places, l.entry, l.registration_closes_at,
              (SELECT count(*)::int FROM league_members m WHERE m.league_id = l.id AND m.status = 'active') AS players
         FROM leagues l
        WHERE l.access = 'public' AND l.status = 'registration' AND (l.registration_closes_at IS NULL OR l.registration_closes_at > $1)
        ORDER BY players DESC, l.registration_closes_at NULLS LAST LIMIT 1`,
      [now],
    );
    const p = pub.rows[0];

    return {
      unread: unread.rows[0]?.n ?? 0,
      todo: myTurns + (challenges.rows[0]?.n ?? 0),
      openRooms: { dames: rooms.rows.find((r) => r.game === 'dames')?.n ?? 0, ludo: rooms.rows.find((r) => r.game === 'ludo')?.n ?? 0 },
      nextMatch: n
        ? {
            leagueId: n.league_id,
            leagueName: n.name,
            game: n.game,
            matchId: n.id,
            stage: n.stage,
            round: n.round,
            level: n.level,
            levels: n.levels,
            matchAt: n.match_at.toISOString(),
            opponents: n.opponents,
          }
        : null,
      resume,
      publicLeague: p
        ? {
            id: p.id,
            code: p.code,
            name: p.name,
            game: p.game,
            players: p.players,
            maxPlaces: p.max_places,
            entry: p.entry,
            registrationClosesAt: p.registration_closes_at?.toISOString() ?? null,
          }
        : null,
    };
  });
};

export default homeRoutes;
