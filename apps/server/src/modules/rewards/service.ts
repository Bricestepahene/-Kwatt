/**
 * Médailles, série de jours et quêtes de la semaine (écran 40), victoires marquantes et
 * trophées qui donnent des cartes (écran 39).
 *
 * - Série : un jour compte dès une partie terminée ou un problème du jour tenté
 *   (@kwatt/domain recordActiveDay). Au 7e jour (puis 14e…) : une carte rare au choix.
 * - Quêtes : événements gardés par semaine ISO (quest_events), avancement recalculé
 *   (@kwatt/domain questProgress), récompense récupérée une fois (grand livre, clé
 *   d'idempotence quest:<joueur>:<semaine>:<quête>). Les trois quêtes de la semaine
 *   récupérées : une carte « quête » en plus.
 * - Parties comptées : toutes les parties en ligne terminées (machine comprise) ; les
 *   victoires marquantes comptent seulement les parties entre joueurs, sauf la rafle.
 */
import {
  currentStreak,
  dayNumber,
  daysToNextStreakReward,
  isoWeekKey,
  questProgress,
  recordActiveDay,
  WEEKLY_QUESTS,
  type QuestEvent,
} from '@kwatt/domain';
import type { ClaimResult, QuestView, RewardsView } from '@kwatt/protocol';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { cardsFor, grantCard, unownedCards } from '../cards/service.js';
import { transfer } from '../economy/ledger.js';
import type { GameFinishedEvent } from '../games/service.js';
import type { NotificationService } from '../notifications/service.js';

/** Victoire contre plus fort qui compte comme marquante : 200 points de force d'écart. */
export const UPSET_GAP = 200;
/** Paliers de victoires entre joueurs qui donnent une carte (render.feat = wins_<n>). */
export const WIN_MILESTONES = [10, 50, 100, 200, 250, 500] as const;

export interface RewardsDeps {
  db: Pool;
  clock: Clock;
  log: Logger;
  notifications: NotificationService;
}

/** Fin de la semaine ISO en cours (lundi suivant 00:00, heure du Cameroun). */
function weekEnd(now: number): Date {
  const week = isoWeekKey(now);
  // Au plus 7 jours : on avance d'heure en heure jusqu'au changement de semaine.
  let t = Math.floor(now / 3_600_000) * 3_600_000;
  while (isoWeekKey(t) === week) t += 3_600_000;
  return new Date(t);
}

export class RewardsService {
  constructor(private readonly deps: RewardsDeps) {}

  // --- Série de jours ------------------------------------------------------------------

  /** Activité du jour (partie terminée, problème du jour tenté). Idempotent par jour. */
  async recordActivity(userId: string, at = this.deps.clock.now()): Promise<void> {
    const today = dayNumber(at.getTime());
    const granted = await transaction(this.deps.db, async (tx) => {
      const r = await tx.query<{ last_day: number; length: number; best: number }>('SELECT last_day, length, best FROM day_streaks WHERE user_id = $1 FOR UPDATE', [
        userId,
      ]);
      const row = r.rows[0];
      const up = recordActiveDay(row ? { lastDay: row.last_day, length: row.length } : { lastDay: null, length: 0 }, today);
      if (up.alreadyCounted) return [];
      const best = Math.max(row?.best ?? 0, up.streak.length);
      await tx.query(
        `INSERT INTO day_streaks (user_id, last_day, length, best, rare_choices) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET last_day = $2, length = $3, best = $4, rare_choices = day_streaks.rare_choices + $5`,
        [userId, today, up.streak.length, best, up.rareCardEarned ? 1 : 0],
      );
      if (up.rareCardEarned) await this.deps.notifications.notify(tx, userId, 'rewards.streak', { days: up.streak.length });
      // Séries plus longues (30, 60 jours) : leur carte, une fois.
      const out: string[] = [];
      for (const days of [30, 60]) {
        if (up.streak.length < days) continue;
        for (const code of await cardsFor(tx, 'days', String(days))) {
          if (await grantCard(tx, userId, code)) {
            await this.deps.notifications.notify(tx, userId, 'rewards.card', { code });
            out.push(code);
          }
        }
      }
      return out;
    });
    if (granted.length) this.deps.log.info({ userId, granted }, 'cartes de série données');
  }

  // --- Fin de partie -------------------------------------------------------------------

  /** Plus grande rafle (pièces prises d'un coup) de chaque place aux Dames. */
  private async raflesBySeat(gameId: string): Promise<Map<number, number>> {
    const r = await this.deps.db.query<{ seat: number; best: number }>(
      `SELECT seat, max(array_length(string_to_array(payload->>'n', 'x'), 1) - 1)::int AS best
         FROM moves WHERE game_id = $1 AND kind = 'move' AND payload->>'n' LIKE '%x%' GROUP BY seat`,
      [gameId],
    );
    return new Map(r.rows.map((x) => [x.seat, x.best]));
  }

  /** Aller-retour terminé : le joueur a gagné les deux manches. */
  private async twoLegWinner(event: GameFinishedEvent): Promise<string | null> {
    if (event.room?.leg !== 2) return null;
    const r = await this.deps.db.query<{ user_id: string; wins: number }>(
      `WITH legs AS (
         SELECT g.id FROM games g WHERE g.room_id = $1 AND g.status = 'finished' AND g.id <> $2 AND g.ended_at IS NOT NULL
          ORDER BY g.ended_at DESC LIMIT 1
       )
       SELECT gp.user_id, count(*)::int AS wins FROM game_players gp
        WHERE gp.game_id IN (SELECT id FROM legs UNION SELECT $2::uuid) AND gp.result = 'win' AND gp.user_id IS NOT NULL
        GROUP BY gp.user_id`,
      [event.room.roomId, event.gameId],
    );
    return r.rows.find((x) => x.wins >= 2)?.user_id ?? null;
  }

  async onGameFinished(event: GameFinishedEvent): Promise<void> {
    const humans = event.seats.filter((s): s is typeof s & { userId: string } => s.userId !== null);
    if (humans.length === 0) return;
    const members = await this.deps.db.query<{ user_id: string }>(
      `SELECT u.id AS user_id FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ANY($1::uuid[]) AND u.erased_at IS NULL`,
      [humans.map((s) => s.userId)],
    );
    const memberIds = new Set(members.rows.map((x) => x.user_id));
    const game: 'dames' | 'ludo' = event.variant.startsWith('dames') ? 'dames' : 'ludo';
    const place = (seat: number) => event.outcome.places[String(seat)] ?? 99;
    const rafles = game === 'dames' ? await this.raflesBySeat(event.gameId) : new Map<number, number>();
    const twoLeg = await this.twoLegWinner(event);
    const ratings = await this.deps.db.query<{ user_id: string; before: number }>('SELECT user_id, before FROM rating_history WHERE game_id = $1', [event.gameId]);
    const before = new Map(ratings.rows.map((x) => [x.user_id, x.before]));
    const now = this.deps.clock.now();
    const week = isoWeekKey(now.getTime());
    const betweenPlayers = event.context !== 'machine' && humans.length >= 2;

    for (const s of humans) {
      if (!memberIds.has(s.userId)) continue;
      try {
        await this.recordActivity(s.userId, now);
        const won = !event.outcome.draw && place(s.seat) === 1;
        const events: QuestEvent[] = [];
        if (won) events.push({ kind: 'game_won', game });
        if (twoLeg === s.userId) events.push({ kind: 'two_leg_won', game });
        const rafle = rafles.get(s.seat) ?? 0;
        if (rafle >= 2) events.push({ kind: 'capture', game: 'dames', count: rafle });
        const questsBefore = await this.questState(this.deps.db, s.userId, week);
        for (const e of events) {
          await this.deps.db.query(
            `INSERT INTO quest_events (user_id, week, source, event, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [s.userId, week, `game:${event.gameId}`, JSON.stringify(e), now],
          );
        }
        if (events.length) await this.notifyNewlyDone(s.userId, week, questsBefore);

        // Victoires marquantes.
        const feats: string[] = [];
        if (rafle >= 4) feats.push('rafle_4');
        if (rafle >= 5) feats.push('rafle_5');
        if (won && betweenPlayers) {
          const mine = before.get(s.userId);
          const beaten = humans.filter((o) => o.userId !== s.userId).map((o) => before.get(o.userId)).filter((x): x is number => x !== undefined);
          if (event.ranked && mine !== undefined && beaten.some((b) => b - mine >= UPSET_GAP)) feats.push(game === 'dames' ? 'upset_dames' : 'upset_ludo');
          if (game === 'ludo' && event.seats.length >= 4) feats.push('ludo_table_4');
          const wins = await this.deps.db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM game_players gp JOIN games g ON g.id = gp.game_id
              WHERE gp.user_id = $1 AND gp.result = 'win' AND g.context <> 'machine' AND g.status = 'finished'`,
            [s.userId],
          );
          const n = wins.rows[0]?.n ?? 0;
          if (n >= 1) feats.push('first_win');
          for (const m of WIN_MILESTONES) if (n >= m) feats.push(`wins_${m}`);
        }
        await this.grantFeats(s.userId, feats);
      } catch (err) {
        this.deps.log.error({ err, userId: s.userId, gameId: event.gameId }, 'récompenses de fin de partie en échec');
      }
    }
  }

  private async grantFeats(userId: string, feats: string[]): Promise<void> {
    for (const feat of feats) {
      for (const code of await cardsFor(this.deps.db, 'feat', feat)) {
        await transaction(this.deps.db, async (tx) => {
          if (await grantCard(tx, userId, code)) await this.deps.notifications.notify(tx, userId, 'rewards.card', { code });
        });
      }
    }
  }

  /** Médailles de ligue (argent, bronze) : leur carte trophée. L'or donne déjà le Trophée Ngondo (ligues). */
  async grantMedalCards(): Promise<number> {
    const r = await this.deps.db.query<{ user_id: string; kind: string }>(
      `SELECT DISTINCT m.user_id, m.kind FROM medals m JOIN profiles p ON p.user_id = m.user_id
        WHERE m.kind IN ('argent', 'bronze')
          AND NOT EXISTS (
            SELECT 1 FROM owned_items o JOIN items i ON i.id = o.item_id
             WHERE o.user_id = m.user_id AND i.render->>'trophy' = CASE m.kind WHEN 'argent' THEN 'league_silver' ELSE 'league_bronze' END)
        LIMIT 500`,
    );
    let n = 0;
    for (const row of r.rows) {
      for (const code of await cardsFor(this.deps.db, 'trophy', row.kind === 'argent' ? 'league_silver' : 'league_bronze')) {
        await transaction(this.deps.db, async (tx) => {
          if (await grantCard(tx, row.user_id, code)) {
            n++;
            await this.deps.notifications.notify(tx, row.user_id, 'rewards.card', { code });
          }
        });
      }
    }
    return n;
  }

  // --- Quêtes --------------------------------------------------------------------------

  private async questState(db: Sql, userId: string, week: string): Promise<Map<string, { progress: number; done: boolean; claimed: boolean; legWon: boolean }>> {
    const ev = await db.query<{ event: QuestEvent }>('SELECT event FROM quest_events WHERE user_id = $1 AND week = $2', [userId, week]);
    const claims = await db.query<{ quest_id: string }>('SELECT quest_id FROM quest_claims WHERE user_id = $1 AND week = $2', [userId, week]);
    const events = ev.rows.map((x) => x.event);
    const claimed = new Set(claims.rows.map((x) => x.quest_id));
    const out = new Map<string, { progress: number; done: boolean; claimed: boolean; legWon: boolean }>();
    for (const def of WEEKLY_QUESTS) {
      const p = questProgress(def, events);
      out.set(def.id, { progress: p.progress, done: p.done, claimed: claimed.has(def.id), legWon: false });
    }
    return out;
  }

  private async notifyNewlyDone(userId: string, week: string, before: Map<string, { done: boolean }>): Promise<void> {
    const after = await this.questState(this.deps.db, userId, week);
    for (const def of WEEKLY_QUESTS) {
      if (after.get(def.id)?.done && !before.get(def.id)?.done) {
        await this.deps.notifications.notify(this.deps.db, userId, 'quest.completed', {
          questId: def.id,
          ...(def.reward.kind === 'cauris' ? { amount: def.reward.amount } : {}),
        });
      }
    }
  }

  async view(userId: string, db: Sql = this.deps.db): Promise<RewardsView> {
    const now = this.deps.clock.now().getTime();
    const week = isoWeekKey(now);
    const today = dayNumber(now);
    // Requêtes l'une après l'autre : `db` peut être une transaction (un seul client).
    const medals = await db.query<{ kind: string; n: number }>('SELECT kind, count(*)::int AS n FROM medals WHERE user_id = $1 GROUP BY kind', [userId]);
    const streakRow = await db.query<{ last_day: number; length: number; best: number; rare_choices: number }>(
      'SELECT last_day, length, best, rare_choices FROM day_streaks WHERE user_id = $1',
      [userId],
    );
    const trophies = await db.query<{ league_id: string | null; title: string; kind: 'or' | 'argent' | 'bronze'; awarded_at: Date }>(
      `SELECT m.league_id, COALESCE(l.name, m.title) AS title, m.kind, m.awarded_at
         FROM medals m LEFT JOIN leagues l ON l.id = m.league_id WHERE m.user_id = $1 ORDER BY m.awarded_at DESC LIMIT 20`,
      [userId],
    );
    const state = await this.questState(db, userId, week);
    const count = (k: string) => medals.rows.find((x) => x.kind === k)?.n ?? 0;
    const s = streakRow.rows[0];
    const length = s ? currentStreak({ lastDay: s.last_day, length: s.length }, today) : 0;
    const rareChoices = s?.rare_choices ?? 0;
    // Aller-retour : l'aller gagné cette semaine (retour à jouer).
    const leg = await db.query(
      `SELECT 1 FROM game_players gp JOIN games g ON g.id = gp.game_id JOIN rooms r ON r.id = g.room_id
        WHERE gp.user_id = $1 AND gp.result = 'win' AND r.format = 'aller_retour' AND r.leg = 2 AND r.last_game_id = g.id LIMIT 1`,
      [userId],
    );
    const quests: QuestView[] = WEEKLY_QUESTS.map((def) => {
      const st = state.get(def.id)!;
      return {
        id: def.id,
        game: def.game,
        target: def.target,
        progress: st.progress,
        done: st.done,
        claimed: st.claimed,
        reward: def.reward,
        ...(def.kind === 'win_two_leg' && !st.done ? { legWon: (leg.rowCount ?? 0) > 0 } : {}),
      };
    });
    return {
      medals: { gold: count('or'), silver: count('argent'), bronze: count('bronze') },
      streak: {
        length,
        best: s?.best ?? 0,
        daysToReward: daysToNextStreakReward(length),
        today: s?.last_day === today,
        rareChoices,
        choices: rareChoices > 0 ? await unownedCards(db, userId, 'streak', 'rare') : [],
      },
      week,
      weekEndsAt: weekEnd(now).toISOString(),
      quests,
      trophies: trophies.rows.map((x) => ({ leagueId: x.league_id, title: x.title, kind: x.kind, awardedAt: x.awarded_at.toISOString() })),
    };
  }

  /** Récupérer la récompense d'une quête terminée (une fois). */
  async claim(userId: string, questId: string): Promise<ClaimResult> {
    const def = WEEKLY_QUESTS.find((q) => q.id === questId);
    if (!def) throw new AppError('rewards.quest_not_found', 404);
    const week = isoWeekKey(this.deps.clock.now().getTime());
    return transaction(this.deps.db, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`quest:${userId}:${week}`]);
      const state = (await this.questState(tx, userId, week)).get(def.id)!;
      if (state.claimed) throw new AppError('rewards.already_claimed', 409);
      if (!state.done) throw new AppError('rewards.quest_not_done', 409);
      let cauris = 0;
      let card: string | null = null;
      if (def.reward.kind === 'cauris') {
        cauris = def.reward.amount;
        await transfer(tx, {
          kind: 'quest_reward',
          idempotencyKey: `quest:${userId}:${week}:${def.id}`,
          entries: [
            { wallet: { system: 'rewards' }, amount: -cauris },
            { wallet: { userId }, amount: cauris },
          ],
          meta: { questId: def.id, week },
        });
      } else {
        card = (await unownedCards(tx, userId, 'streak', def.reward.rarity))[0] ?? (await unownedCards(tx, userId, 'quest', def.reward.rarity))[0] ?? null;
        if (card) await grantCard(tx, userId, card);
      }
      await tx.query('INSERT INTO quest_claims (user_id, week, quest_id, item_code) VALUES ($1, $2, $3, $4)', [userId, week, def.id, card]);
      // Les trois quêtes de la semaine récupérées : une carte « quête » en plus.
      const claims = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM quest_claims WHERE user_id = $1 AND week = $2', [userId, week]);
      if ((claims.rows[0]?.n ?? 0) === WEEKLY_QUESTS.length) {
        const bonus = (await unownedCards(tx, userId, 'quest'))[0];
        if (bonus && (await grantCard(tx, userId, bonus))) {
          await this.deps.notifications.notify(tx, userId, 'rewards.card', { code: bonus });
          card = card ?? bonus;
        }
      }
      return { rewards: await this.view(userId, tx), cauris, card };
    });
  }

  /** Carte rare au choix (série de 7 jours). */
  async chooseStreakCard(userId: string, code: string): Promise<ClaimResult> {
    return transaction(this.deps.db, async (tx: Transaction) => {
      const r = await tx.query<{ rare_choices: number }>('SELECT rare_choices FROM day_streaks WHERE user_id = $1 FOR UPDATE', [userId]);
      if ((r.rows[0]?.rare_choices ?? 0) <= 0) throw new AppError('rewards.no_choice', 409);
      const choices = await unownedCards(tx, userId, 'streak', 'rare');
      if (!choices.includes(code)) throw new AppError('rewards.no_choice', 409);
      await grantCard(tx, userId, code);
      await tx.query('UPDATE day_streaks SET rare_choices = rare_choices - 1 WHERE user_id = $1', [userId]);
      return { rewards: await this.view(userId, tx), cauris: 0, card: code };
    });
  }
}

