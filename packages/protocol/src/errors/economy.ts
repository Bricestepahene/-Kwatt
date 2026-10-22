/** Codes d'erreur des cauris (grand livre, séquestre, portefeuille). */
export const ECONOMY_ERRORS = [
  /** Solde insuffisant (params.balance, params.required). */
  'wallet.insufficient_funds',
  /** Portefeuille introuvable. */
  'wallet.not_found',
  /** Écritures invalides : somme non nulle, montant nul, portefeuille en double (erreur de programmation). */
  'ledger.invalid_entries',
  /** Clé d'idempotence déjà utilisée pour un autre mouvement. */
  'ledger.idempotency_conflict',
] as const;
