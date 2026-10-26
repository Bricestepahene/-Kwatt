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
export * from './http/shop.js';
export * from './http/profiles.js';
export * from './http/quarters.js';
export * from './http/accounts.js';
export * from './http/rooms.js';
export * from './http/ratings.js';
export * from './http/machine.js';
export * from './http/puzzles.js';
export * from './http/games.js';
export * from './ws/envelope.js';
export * from './ws/base.js';
export * from './http/ludo.js';
export * from './http/leagues.js';
export * from './ws/games.js';
export * from './ws/rooms.js';
export * from './http/challenges.js';
export * from './http/friends.js';
export * from './http/reports.js';
