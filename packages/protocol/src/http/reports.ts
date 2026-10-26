/**
 * Signaler ou bloquer (écran 38). Profils seulement.
 *
 * Routes (module serveur « reports ») :
 *   GET    /v1/reports/context/:userId  → ReportContext (partie jointe d'office, déjà bloqué ?)
 *   POST   /v1/reports                  ReportRequest → ReportResult (201)
 *   GET    /v1/blocks                   → BlockListResponse
 *   POST   /v1/blocks                   BlockRequest → OkResponse
 *   DELETE /v1/blocks/:userId           → OkResponse
 *
 * Bloquer défait l'amitié et les demandes en cours ; le bloqué ne peut plus t'inviter, te
 * défier ni t'écrire (vérifié côté serveur : isBlocked de friends/relations). On ne lui dit
 * jamais qu'il est bloqué.
 *
 * Modération (ADMIN_TOKEN) :
 *   GET  /v1/admin/reports?status=open
 *   POST /v1/admin/reports/:id/resolve  { decision: dismissed|warned|actioned, note? }
 *   « warned » envoie la notification `account.warning` { reason } au joueur signalé.
 */
import { z } from 'zod';
import { IsoDateSchema, UuidSchema } from './common.js';
import { PlayerLookSchema } from './profiles.js';

/** Motifs de la planche : aide extérieure, insultes, photo, deux comptes, autre chose. */
export const REPORT_REASONS = ['outside_help', 'insults', 'photo', 'multi_account', 'other'] as const;
export const ReportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export const REPORT_MESSAGE_MAX = 500;
/** Au plus 10 signalements par joueur et par jour. */
export const REPORTS_PER_DAY = 10;

export const ReportGameSchema = z.object({
  gameId: UuidSchema,
  family: z.enum(['dames', 'ludo', 'raisonnement']),
  variant: z.string(),
  /** Fin de la partie, ou début si elle est en cours. */
  playedAt: IsoDateSchema,
});
export type ReportGame = z.infer<typeof ReportGameSchema>;

export const ReportContextSchema = z.object({
  userId: UuidSchema,
  /** Dernière partie jouée ensemble, jointe d'office ; null si aucune. */
  game: ReportGameSchema.nullable(),
  /** Tu as déjà bloqué ce joueur. */
  blocked: z.boolean(),
  /** Un signalement de ta part attend déjà la modération. */
  pending: z.boolean(),
});
export type ReportContext = z.infer<typeof ReportContextSchema>;

export const ReportRequestSchema = z
  .object({
    userId: UuidSchema,
    reason: ReportReasonSchema,
    /** Obligatoire pour « Autre chose ». */
    message: z.string().trim().max(REPORT_MESSAGE_MAX).optional(),
    /** Partie précise ; sinon la dernière jouée ensemble. */
    gameId: UuidSchema.optional(),
    /** « Bloquer aussi ». */
    block: z.boolean(),
  })
  .refine((r) => r.reason !== 'other' || (r.message !== undefined && r.message.length >= 3), { message: 'message_required', path: ['message'] });
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

export const ReportResultSchema = z.object({
  reportId: UuidSchema,
  gameId: UuidSchema.nullable(),
  blocked: z.boolean(),
});
export type ReportResult = z.infer<typeof ReportResultSchema>;

export const BlockRequestSchema = z.object({ userId: UuidSchema });
export type BlockRequest = z.infer<typeof BlockRequestSchema>;

export const BlockedPlayerSchema = z.object({
  userId: UuidSchema,
  pseudo: z.string(),
  avatar: PlayerLookSchema.nullable(),
  blockedAt: IsoDateSchema,
});
export type BlockedPlayer = z.infer<typeof BlockedPlayerSchema>;
export const BlockListResponseSchema = z.object({ items: z.array(BlockedPlayerSchema) });
export type BlockListResponse = z.infer<typeof BlockListResponseSchema>;

export const REPORT_DECISIONS = ['dismissed', 'warned', 'actioned'] as const;
export const ResolveReportRequestSchema = z.object({
  decision: z.enum(REPORT_DECISIONS),
  note: z.string().max(1000).optional(),
});
export type ResolveReportRequest = z.infer<typeof ResolveReportRequestSchema>;
