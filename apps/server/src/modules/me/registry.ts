/**
 * Données d'un compte réparties entre modules : chaque module déclare
 * - ce qu'il efface quand un compte est supprimé (`onErase`, exécuté AVANT l'effacement
 *   des tables de base, dans la même transaction) ;
 * - ce qu'il ajoute à l'export JSON du joueur (`addExportSection`).
 *
 *   app.accounts.onErase('rooms', async (tx, userId) => { await tx.query('DELETE FROM …', [userId]); });
 *   app.accounts.addExportSection('leagues', async (db, userId) => (await db.query(…)).rows);
 */
import type { Pool, Transaction } from '../../db/pool.js';

export type EraseHook = (tx: Transaction, userId: string) => Promise<void>;
export type ExportSection = (db: Pool, userId: string) => Promise<unknown>;

export class AccountRegistry {
  private readonly eraseHooks = new Map<string, EraseHook>();
  private readonly exportSections = new Map<string, ExportSection>();

  onErase(name: string, hook: EraseHook): void {
    if (this.eraseHooks.has(name)) throw new Error(`Crochet d'effacement déjà enregistré : ${name}`);
    this.eraseHooks.set(name, hook);
  }

  addExportSection(name: string, section: ExportSection): void {
    if (this.exportSections.has(name)) throw new Error(`Section d'export déjà enregistrée : ${name}`);
    this.exportSections.set(name, section);
  }

  async runEraseHooks(tx: Transaction, userId: string): Promise<void> {
    for (const hook of this.eraseHooks.values()) await hook(tx, userId);
  }

  async buildExport(db: Pool, userId: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [name, section] of this.exportSections) out[name] = await section(db, userId);
    return out;
  }
}
