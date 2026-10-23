/**
 * Portefeuille de cauris (SPEC §7). Pas d'argent réel : les cauris ne s'achètent pas et ne se retirent pas.
 *
 * Routes :
 *   GET /v1/wallet           → WalletResponse
 *   GET /v1/wallet/journal   ?cursor&limit → JournalResponse (du plus récent au plus ancien)
 */
import { z } from 'zod';
import { IsoDateSchema, UuidSchema, paginated } from './common.js';

/** Bonus de bienvenue, versé une fois à la création du profil. */
export const WELCOME_BONUS = 500;

/**
 * Natures de mouvement du grand livre. La liste sert de référence aux traductions de l'appli
 * (« Bonus de bienvenue », « Mise bloquée »…) ; chaque module ajoute les siennes ici.
 * Le schéma de lecture accepte toute chaîne, pour qu'une appli ancienne ne casse pas.
 */
export const LEDGER_KINDS = [
  'welcome_bonus',
  'participation',
  'machine_win',
  'machine_bet',
  'stake_lock',
  'stake_payout',
  'stake_refund',
  'purchase',
  'quest_reward',
  'daily_problem',
  'league_entry',
  'league_payout',
  'league_refund',
  'league_caution',
  'league_fine',
  'league_bonus',
  'prediction_lock',
  'prediction_payout',
  'prediction_refund',
  'admin_adjust',
  'account_erased',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const WalletResponseSchema = z.object({
  balance: z.number().int(),
});
export type WalletResponse = z.infer<typeof WalletResponseSchema>;

export const JournalEntrySchema = z.object({
  txId: UuidSchema,
  kind: z.string(),
  /** + crédit, − débit, en cauris. */
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  gameId: UuidSchema.nullable(),
  /** Détails pour l'affichage (adversaire, quête…) : jamais une phrase. */
  meta: z.record(z.string(), z.unknown()),
  createdAt: IsoDateSchema,
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const JournalResponseSchema = paginated(JournalEntrySchema);
export type JournalResponse = z.infer<typeof JournalResponseSchema>;
