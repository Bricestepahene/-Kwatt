/**
 * Problème du jour (écran 19b) : le même problème pour tout le monde, choisi par
 * `dailyPuzzle` (@kwatt/engine-dames) selon le jour du Cameroun (`dayNumber` de
 * @kwatt/domain). La solution envoyée est revalidée par @kwatt/rules-dames.
 *
 * Résolu : +10 cauris une fois par jour (grand livre, mouvement `daily_problem`, clé
 * `daily_problem:<joueur>:<jour>`), série de jours résolus ; tous les 7 jours de suite, la
 * prochaine carte rare du catalogue qu'il n'a pas encore (grantItem du module boutique), si
 * le catalogue en propose une, sinon rien.
 */
import { createRequire } from 'node:module';
import {
  DAILY_PUZZLE_REWARD,
  currentStreak,
  dayKey,
  dayNumber,
  daysToNextStreakReward,
  recordActiveDay,
} from '@kwatt/domain';
import { dailyPuzzle, isPuzzleFile, puzzleState, type Puzzle } from '@kwatt/engine-dames';
import type { DailyPuzzleResponse, DailyPuzzleSolveResponse, PuzzleVariant } from '@kwatt/protocol';
import { applyMove, moveKey, parseNotation, type Move } from '@kwatt/rules-dames';
import { transaction, type Pool, type Sql, type Transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { transfer } from '../economy/ledger.js';
import { grantItem } from '../shop/catalog.js';

const require = createRequire(import.meta.url);
const cache = new Map<PuzzleVariant, Puzzle[]>();

/** Problèmes livrés avec le moteur (`@kwatt/engine-dames/puzzles/<variante>.json`). */
export function puzzlesOf(variant: PuzzleVariant): Puzzle[] {
  let list = cache.get(variant);
  if (!list) {
    const file: unknown = require(`@kwatt/engine-dames/puzzles/${variant}.json`);
    if (!isPuzzleFile(file)) throw new Error(`Fichier de problèmes invalide : ${variant}`);
    list = file.puzzles;
    cache.set(variant, list);
  }
  return list;
}

export function puzzleOfDay(variant: PuzzleVariant, day: number): Puzzle {
  const list = puzzlesOf(variant);
  if (list.length === 0) throw new AppError('puzzle.not_found', 404, { variant });
  return dailyPuzzle(list, day);
}

/**
 * La suite proposée est-elle la solution ? `moves` : les coups du joueur seulement, ou toute
 * la suite (réponses forcées comprises). Comparaison par identité de coup (mêmes pièces
 * prises), pas par écriture.
 */
export function checkSolution(puzzle: Puzzle, moves: readonly string[]): boolean {
  let state = puzzleState(puzzle);
  const expected: Move[] = [];
  for (const text of puzzle.solution) {
    const m = parseNotation(state, text);
    if (!m) return false;
    expected.push(m);
    state = applyMove(state, m);
  }
  const full = moves.length === puzzle.solution.length;
  const own = Math.ceil(puzzle.solution.length / 2);
  if (!full && moves.length !== own) return false;
  state = puzzleState(puzzle);
  let k = 0;
  for (const [i, exp] of expected.entries()) {
    const mine = i % 2 === 0;
    if (full || mine) {
      const text = moves[k++]!;
      const m = parseNotation(state, text);
      if (!m || moveKey(m) !== moveKey(exp)) return false;
    }
    state = applyMove(state, exp);
  }
  return true;
}

interface StreakRow {
  last_day: number | null;
  length: number;
}

async function streakOf(db: Sql, userId: string, lock = false): Promise<StreakRow> {
  const r = await db.query<StreakRow>(`SELECT last_day, length FROM puzzle_streaks WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`, [userId]);
  return r.rows[0] ?? { last_day: null, length: 0 };
}

/** Part des joueurs qui ont trouvé (en %), à partir de 10 joueurs. */
async function solvedShare(db: Sql, day: string, variant: PuzzleVariant): Promise<number | null> {
  const r = await db.query<{ total: number; solved: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE solved)::int AS solved FROM puzzle_attempts WHERE day = $1 AND variant = $2`,
    [day, variant],
  );
  const row = r.rows[0];
  if (!row || row.total < 10) return null;
  return Math.round((row.solved * 100) / row.total);
}

export async function dailyFor(db: Sql, userId: string, variant: PuzzleVariant, now: Date): Promise<DailyPuzzleResponse> {
  const at = now.getTime();
  const today = dayNumber(at);
  const key = dayKey(at);
  const puzzle = puzzleOfDay(variant, today);
  const tomorrow = puzzleOfDay(variant, today + 1);
  const [solved, streak, share] = await Promise.all([
    db.query('SELECT 1 FROM puzzle_solves WHERE user_id = $1 AND day = $2', [userId, key]),
    streakOf(db, userId),
    solvedShare(db, key, variant),
  ]);
  const length = currentStreak({ lastDay: streak.last_day, length: streak.length }, today);
  return {
    dayKey: key,
    puzzle: {
      id: puzzle.id,
      variant: puzzle.variant,
      side: puzzle.side,
      white: puzzle.white,
      black: puzzle.black,
      solution: puzzle.solution,
      difficulty: puzzle.difficulty,
      theme: puzzle.theme,
    },
    solved: (solved.rowCount ?? 0) > 0,
    streak: length,
    daysToReward: daysToNextStreakReward(length),
    reward: DAILY_PUZZLE_REWARD,
    solvedShare: share,
    tomorrowTheme: tomorrow.theme,
  };
}

/** Prochaine carte rare du catalogue que le joueur n'a pas (null si aucune). */
async function nextRareCard(tx: Transaction, userId: string): Promise<string | null> {
  const r = await tx.query<{ code: string }>(
    `SELECT i.code FROM items i
      WHERE i.kind = 'card' AND i.rarity = 'rare' AND i.retired_at IS NULL AND i.price IS NULL AND NOT i.is_default
        AND (i.edition_total IS NULL OR i.edition_sold < i.edition_total)
        AND NOT EXISTS (SELECT 1 FROM owned_items o WHERE o.item_id = i.id AND o.user_id = $1)
      ORDER BY i.sort_order, i.code LIMIT 1`,
    [userId],
  );
  return r.rows[0]?.code ?? null;
}

export async function solveDaily(
  db: Pool,
  userId: string,
  input: { dayKey: string; variant: PuzzleVariant; moves: string[] },
  now: Date,
): Promise<DailyPuzzleSolveResponse> {
  const at = now.getTime();
  const today = dayNumber(at);
  const key = dayKey(at);
  if (input.dayKey !== key) throw new AppError('puzzle.wrong_day', 409, { dayKey: key });
  const puzzle = puzzleOfDay(input.variant, today);
  const correct = checkSolution(puzzle, input.moves);

  return transaction(db, async (tx) => {
    await tx.query(`INSERT INTO puzzle_streaks (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    const streak = await streakOf(tx, userId, true);
    await tx.query(
      `INSERT INTO puzzle_attempts (user_id, day, variant, attempts, solved) VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (user_id, day, variant) DO UPDATE SET attempts = puzzle_attempts.attempts + 1,
         solved = puzzle_attempts.solved OR EXCLUDED.solved`,
      [userId, key, input.variant, correct],
    );
    const state = { lastDay: streak.last_day, length: streak.length };
    const already = await tx.query('SELECT 1 FROM puzzle_solves WHERE user_id = $1 AND day = $2', [userId, key]);
    const alreadySolved = (already.rowCount ?? 0) > 0;

    if (!correct || alreadySolved) {
      const length = currentStreak(state, today);
      return { correct, reward: 0, streak: length, daysToReward: daysToNextStreakReward(length), card: null, alreadySolved };
    }

    await tx.query(`INSERT INTO puzzle_solves (user_id, day, variant, puzzle_id, moves) VALUES ($1, $2, $3, $4, $5)`, [
      userId,
      key,
      input.variant,
      puzzle.id,
      JSON.stringify(input.moves),
    ]);
    await transfer(tx, {
      kind: 'daily_problem',
      idempotencyKey: `daily_problem:${userId}:${key}`,
      meta: { puzzleId: puzzle.id, variant: input.variant, day: key },
      entries: [
        { wallet: { system: 'rewards' }, amount: -DAILY_PUZZLE_REWARD },
        { wallet: { userId }, amount: DAILY_PUZZLE_REWARD },
      ],
    });
    const update = recordActiveDay(state, today);
    await tx.query(
      `UPDATE puzzle_streaks SET last_day = $2, length = $3, best = GREATEST(best, $3), updated_at = now() WHERE user_id = $1`,
      [userId, update.streak.lastDay, update.streak.length],
    );
    let card: string | null = null;
    if (update.rareCardEarned) {
      const code = await nextRareCard(tx, userId);
      if (code) {
        try {
          const granted = await grantItem(tx, userId, code, 'reward');
          card = granted.code;
        } catch (err) {
          // Édition épuisée entre-temps : la carte manque, la résolution reste valable.
          if (!(err instanceof AppError)) throw err;
        }
      }
    }
    return {
      correct: true,
      reward: DAILY_PUZZLE_REWARD,
      streak: update.streak.length,
      daysToReward: daysToNextStreakReward(update.streak.length),
      card,
      alreadySolved: false,
    };
  });
}
