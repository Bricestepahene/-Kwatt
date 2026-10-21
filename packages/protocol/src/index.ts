/**
 * @kwatt/protocol : contrat partagé entre l'appli et le serveur (schémas zod + types).
 * Chaque module ajoute ses fichiers (`src/http/<module>.ts`, `src/ws/<module>.ts`,
 * `src/errors/<module>.ts`) et une ligne d'export ci-dessous.
 */
export * from './errors.js';
export * from './http/common.js';
export * from './http/me.js';
export * from './http/auth.js';
export * from './http/wallet.js';
export * from './http/notifications.js';
export * from './ws/envelope.js';
export * from './ws/base.js';
