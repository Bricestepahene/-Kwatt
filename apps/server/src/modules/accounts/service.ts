/**
 * Comptes (équipe Comptes) : ce qui complète modules/auth et modules/me.
 * - quartier du joueur (premier lancement, Paramètres) : un changement par saison ;
 * - nom de partie d'un invité (rejoindre un salon sans profil).
 */
import type { DisplayNameResponse, MyQuarterResponse, Quarter, QuarterSearchQuery } from '@kwatt/protocol';
import type { FastifyInstance } from 'fastify';
import { transaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import type { AuthContext } from '../auth/context.js';
import { checkDisplayName } from './display-name.js';
import { findQuarter, myQuarter, nextQuarterChangeAt, searchQuarters, type ProfileQuarterRow } from './quarters.js';

export class AccountsService {
  constructor(private readonly app: FastifyInstance) {}

  private now(): Date {
    return this.app.clock.now();
  }

  // --- Quartiers ----------------------------------------------------------------------

  search(query: QuarterSearchQuery): Promise<Quarter[]> {
    return searchQuarters(this.app.db, query);
  }

  async quarter(id: string): Promise<Quarter> {
    const q = await findQuarter(this.app.db, id);
    if (!q) throw new AppError('quarter.not_found', 404);
    return q;
  }

  private async profileQuarter(userId: string): Promise<ProfileQuarterRow> {
    const r = await this.app.db.query<ProfileQuarterRow>(
      'SELECT quarter, quarter_since, quarter_changed_at FROM profiles WHERE user_id = $1',
      [userId],
    );
    const row = r.rows[0];
    if (!row) throw new AppError('auth.member_required', 403);
    return row;
  }

  async myQuarter(auth: AuthContext): Promise<MyQuarterResponse> {
    return myQuarter(this.app.db, await this.profileQuarter(auth.userId), this.now());
  }

  /**
   * Choisit ou change le quartier. Premier choix : libre. Changement : refusé s'il y en a déjà
   * eu un cette saison (quarter.change_too_soon, params.nextChangeAt). Même quartier : rien.
   */
  async setQuarter(auth: AuthContext, quarterId: string): Promise<MyQuarterResponse> {
    const now = this.now();
    const row = await transaction(
      this.app.db,
      async (tx) => {
        const target = await tx.query<{ id: string }>('SELECT id FROM quarters WHERE id = $1 AND active', [quarterId]);
        if (target.rows.length === 0) throw new AppError('quarter.not_found', 404);
        const r = await tx.query<ProfileQuarterRow>(
          'SELECT quarter, quarter_since, quarter_changed_at FROM profiles WHERE user_id = $1 FOR UPDATE',
          [auth.userId],
        );
        const current = r.rows[0];
        if (!current) throw new AppError('auth.member_required', 403);
        if (current.quarter === quarterId) return current;
        const firstChoice = current.quarter === null;
        if (!firstChoice) {
          const next = nextQuarterChangeAt(current.quarter_changed_at, now);
          if (next) throw new AppError('quarter.change_too_soon', 409, { nextChangeAt: next.toISOString() });
        }
        const u = await tx.query<ProfileQuarterRow>(
          `UPDATE profiles SET quarter = $2, quarter_since = $3,
                  quarter_changed_at = CASE WHEN $4 THEN quarter_changed_at ELSE $3 END
            WHERE user_id = $1
            RETURNING quarter, quarter_since, quarter_changed_at`,
          [auth.userId, quarterId, now, firstChoice],
        );
        const updated = u.rows[0];
        if (!updated) throw new Error('quartier non enregistré');
        return updated;
      },
      { log: this.app.log },
    );
    return myQuarter(this.app.db, row, now);
  }

  // --- Nom de partie -------------------------------------------------------------------

  async displayName(auth: AuthContext): Promise<DisplayNameResponse> {
    const r = await this.app.db.query<{ display_name: string | null }>('SELECT display_name FROM users WHERE id = $1', [auth.userId]);
    return { displayName: r.rows[0]?.display_name ?? null };
  }

  async setDisplayName(auth: AuthContext, raw: string): Promise<DisplayNameResponse> {
    const { name, problem } = checkDisplayName(raw);
    if (problem === 'invalid') throw new AppError('account.display_name_invalid', 400);
    if (problem === 'banned') throw new AppError('account.display_name_banned', 400);
    await this.app.db.query('UPDATE users SET display_name = $2 WHERE id = $1', [auth.userId, name]);
    return { displayName: name };
  }
}
