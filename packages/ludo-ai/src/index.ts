/**
 * @kwatt/ludo-ai : la machine du Ludo, en TypeScript pur (sans Node), utilisée
 * par le service `services/ludo-ai` et par l'appli hors connexion.
 *
 * La machine ne touche jamais au dé : elle reçoit la position avec le lancer
 * déjà fait et choisit un coup (`chooseMove`). La difficulté vient seulement de
 * la qualité des décisions (agent, budget de réflexion).
 *
 * Agents : aléatoire, heuristique explicable, expectimax (max-n ou
 * paranoïaque), MCTS sous budget de temps. Niveaux : Facile, Moyen, Coriace,
 * Ton niveau, Fon (levels.ts, réglages mesurés dans CALIBRATION.md).
 */
export * from './types.js';
export * from './rng.js';
export * from './position.js';
export * from './threats.js';
export * from './agents/random.js';
export * from './agents/heuristic.js';
export * from './agents/expectimax.js';
export * from './agents/mcts.js';
export * from './levels.js';
export * from './choose.js';
export * from './learned.js';
export * from './golden.js';
export * from './calibration.js';
export * from './bench/stats.js';
export * from './bench/match.js';
