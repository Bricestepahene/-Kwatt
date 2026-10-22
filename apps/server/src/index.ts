/**
 * @kwatt/server : ce que les autres modules et les outils réutilisent.
 * Le démarrage du serveur est dans main.ts.
 */
export { buildApp, type BuildAppOptions } from './app.js';
export { loadConfig, type Config } from './config.js';
export { transaction, afterCommit, Transaction, type Pool, type Sql } from './db/pool.js';
export { migrate } from './db/migrate.js';
export { AppError } from './lib/errors.js';
export { parse } from './lib/validate.js';
export { requireAuth } from './modules/auth/plugin.js';
export type { AuthContext } from './modules/auth/context.js';
export { usersShareDevice, sharedDevicePairs } from './modules/auth/devices.js';
export { transfer, balanceOf, escrowBalance, findTransfer, resolveWallet, type TransferInput, type WalletRef } from './modules/economy/ledger.js';
export { lockStake, lockStakes, payoutPot, refundStakes, gameEscrowKey } from './modules/economy/escrow.js';
export { grantWelcomeBonus } from './modules/economy/service.js';
export type { RealtimeHub, WsContext, WsHandler, Connection } from './realtime/hub.js';
