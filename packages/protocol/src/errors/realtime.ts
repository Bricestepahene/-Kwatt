/** Codes d'erreur du temps réel (message WebSocket `{ t: 'error', re, code, params }`). */
export const REALTIME_ERRORS = [
  /** Message illisible (JSON invalide, enveloppe sans `t`). */
  'ws.invalid_message',
  /** Type de message inconnu (params.t). */
  'ws.unknown_type',
  /** Trop de messages en peu de temps. */
  'ws.rate_limited',
] as const;
